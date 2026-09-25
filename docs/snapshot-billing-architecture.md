# ZWS Snapshot & Storage Compatibility Architecture

This document describes the snapshot billing system, its storage-compatibility gate,
and how it stays independent from the backup platform.

## Scope

- Backup Plans
- Backup quota & overage
- Snapshot billing (per-snapshot and plan models)
- Snapshot eligibility (customer ownership + storage capability)
- Credit (wallet) & gateway payment
- Gateway fees & GST
- Restore / rollback / delete
- Console & password changes (unchanged)
- Proxmox storage compatibility detection

## 1. Text architecture diagram

```
                   Client request (Buy snapshot)
                              |
                              v
                 /api/client/snapshot-purchases (POST)
                              |
     +------------------------+-------------------------+
     | 1. customer owns vpsInstance?   (VpsInstance)    |
     | 2. snapshot service enabled?    (settings)       |
     | 3. VM eligible?                 (status checks)  |
     | 4. storage snapshot-capable?    (getVmStorageCapability)
     +------------------------+-------------------------+
                              |
                              v
                 calculate price (per_snapshot price or plan)
                 calculate GST (paymentSettings.gstRate)
                 calculate final payable (decimal-safe)
                              |
                              v
                create billable Order (kind=snapshot_charge)
                + SnapshotCharge row (lifecycle=REQUESTED)
                              |
                              v
              payment: wallet (credit) OR gateway redirect
                              |
                              v
                 gateway webhook / wallet pay
                 -> settleBillableOrderAfterPayment (Redis lock, idempotent)
                              |
                              v
          settleSnapshotCharge -> mark PAID -> runOperationBackground(CREATING)
                              |
                              v
                 createVmSnapshot (re-checks eligibility)
                    -> POST /nodes/{n}/qemu/{vmid}/snapshot -> UPID
                    -> waitForTask(UPID) poll until exitstatus=OK
                    -> verify snapshot exists in live list
                              |
                  +-----------+------------+
                  v                        v
            COMPLETED                   FAILED
            snapshotId set            lifecycle=FAILED
            billing record            refund/reversal:
            invoice/ledger            wallet -> REFUNDED (credit + tx)
                                      gateway -> REFUND_PENDING (manual)
```

## 2. Storage compatibility (payment-first gate)

Snapshots are only offered when the VM's disk storage supports Proxmox snapshots.

- `lib/proxmox-snapshots.ts` → `getVmStorageCapability(nodeId, vmid)` queries the
  real node storage list (`GET /nodes/{node}/storage`) and the VM config, and
  classifies each data disk:

  | Storage type         | Snapshot-capable |
  |----------------------|------------------|
  | `lvmthin`            | yes              |
  | `zfspool` / `zfs`    | yes              |
  | `rbd` / `ceph`       | yes              |
  | `btrfs`              | yes              |
  | `dir` + `qcow2`      | yes              |
  | `dir` + `raw`        | no               |
  | other (nfs, iscsi…)  | no by default    |

- `snapshotCapabilitySummary` exposes a customer-safe summary (capable, storage,
  type). `snapshotSupportIssue` keeps the legacy string message for existing callers.
- The purchase route runs this check **before any order or charge is created**.
  A non-capable VM returns HTTP 409 with a clear message and cannot be charged.
- Admin diagnostics: `GET /api/admin/snapshots?diagnostics=1&nodeId=&vmid=` returns
  the full per-disk breakdown, storage type, format and capability with reason.

### Backup storage vs snapshot storage

These are independent:

- Backup **target** is configured per node (example: `hdd2`, a `dir` storage used
  for vzdump archives). Backups read the VM disk regardless of where it lives.
- Snapshot **capability** depends on where the VM's live disks are stored. A `dir`
  storage can be a valid backup target while being incapable of VM snapshots.

## 3. Snapshot eligibility & pricing

Steps in order (payment-first):

1. Validate the customer owns the VM.
2. Validate snapshot service enabled (independent from backup service).
3. Validate VM eligibility.
4. Validate storage supports snapshots.
5. Compute price (`settings.perSnapshotPrice`, or the active SnapshotPlan:
   free while under `includedSnapshots`, else `overageSnapshotPrice`).
6. Compute GST from `paymentSettings.gstRate` (default 18%).
7. Final payable = `subtotal + gst`, decimal safe (2dp) via
   `lib/billing/snapshot-pricing.ts → calculateSnapshotQuote`.
8. Create the billable `Order` + `SnapshotCharge` (status `unpaid`, lifecycle `REQUESTED`).
9. Pay by credit (wallet) or gateway. Wallet pays only when balance >= total.
10. On payment success, `settleSnapshotCharge` runs the snapshot creation in the
    background, re-running eligibility inside `createVmSnapshot`.

### Money rules

- All money math rounds to 2 decimal places on every intermediate step.
- Example quote: snapshot `₹20.00` + GST `₹3.60` = total `₹23.60`.
  - Credit = `₹23.60` → allowed.
  - Credit = `₹23.59` → rejected (one paisa below the total).
- Gateway fees are applied to **credit top-ups** per gateway (credit settings
  `razorpay/cashfree/phonepeFeePercent` + fixed fee), never silently added to the
  service price. A `₹100` top-up with a 3% fee credits `₹97.00`.

## 4. Snapshot database state machine

`SnapshotCharge.status` + `metadata.lifecycle`:

| lifecycle           | charge.status  | meaning                                     |
|---------------------|----------------|---------------------------------------------|
| REQUESTED           | unpaid         | order created, not yet paid                |
| PAYMENT_PENDING     | unpaid         | awaiting gateway/webhook                   |
| PAID                | paid           | payment captured                           |
| CREATING            | paid           | Proxmox snapshot task running              |
| COMPLETED           | paid           | snapshot exists + verified                 |
| FAILED              | refund_pending | paid but creation failed (auto-refund)     |
| REFUNDED            | refunded       | wallet refunded, ledger credited            |
| REFUND_PENDING      | refund_pending | paid but gateway refund not yet processed  |
| CANCELLED           | cancelled      | abandoned                                    |

`VmSnapshot` rows record the Proxmox-side snapshot (`status`: queued / completed /
failed / cancelled) and carry the node, vmid, snapshot name, UPID in metadata.

## 5. Payment-first guarantees

- Credit is only deducted after the storage-eligibility gate passes.
- If Proxmox creation fails **after** payment, `handleSnapshotChargeFailure`
  runs: wallet-paid charges are reversed to the wallet (a `refund` wallet
  transaction is created once, via `referenceId = ${paymentId}-snapshot-refund`,
  and the charge becomes `refunded`); gateway-paid charges become
  `refund_pending` for the billing team. Audit logs link
  payment → order → charge → refund.
- Refund atomicity: the wallet credit (`createWalletTransaction` on `tx`) and
  the `refunded` status update happen **inside** a single fast interactive
  `$transaction`; panel logs and audit logs are written only **after** that
  transaction commits. Keeping side-effect writes out of the transaction avoids
  Prisma's 5s interactive-transaction timeout rolling back the refund (a bug
  found during live E2E and fixed in `settlement.ts`). The refund path stays
  idempotent: re-running it for the same `paymentId` never double-credits.
- Duplicate webhooks / duplicate pays are blocked by Redis locks on the order and
  the `alreadyRunning` guard on the charge (never two snapshots for one order).

## 6. Snapshot vs backup independence

Creating a snapshot:

- does NOT consume `backupStorageQuotaGB`
- does NOT create backup disk overage
- does NOT increment backup counts
- does NOT modify backup retention
- does NOT run the auto-backup scheduler

## 7. Invoices & revenue

- Snapshot orders produce their own invoice with amounts and the snapshot name.
- Admin report (`/api/admin/billing/overview`) reports `snapshot_charge` revenue
  separately from `backup_plan`, `backup_plan_renewal` and
  `backup_storage_upgrade`; it also tracks snapshot refunds and gateway fees.

## 8. Console & password changes (regression surface)

- Graphical / serial console and the loader are untouched by billing logic.
- Password changes while a VM is running use the QEMU Guest Agent only and only
  update stored credentials after the guest command succeeds. Passwords are never
  logged.

## 9. Live verification (2026-09-20)

VM 465543's primary disk was on `hdd2` (`dir` + `raw`), which Proxmox cannot
snapshot; it was safely moved to `local-lvm` (`lvmthin`) so snapshots work and
backups keep going to `hdd2`.

- **Paid snapshot (Part 22):** `POST /api/client/snapshot-purchases` → order
  `cmu9sif68003no207694z2z95`, wallet payment `cmu9sifab0002pp2v711bps0i`,
  invoice `INV-ZWS-SNAPSH-MU9SIF5V-LASX` (₹20 + 18% GST = ₹23.60), real Proxmox
  snapshot `preupgrade-closure-7162841` on `local-lvm` (UPID
  `UPID:m2-v2:00208875:...:qmsnapshot:465543`). Charge status `paid`,
  lifecycle `COMPLETED`. VM backups stayed at 66 (count/ `backupStorageQuotaGB`
  unaffected).
- **Paid failure → refund (Part 24):** simulated creation failure after payment
  → charge `refunded` / lifecycle `REFUNDED`, `refund` wallet transaction with
  `referenceId = ${paymentId}-snapshot-refund`, wallet restored (net ₹0), no
  snapshot created. This surfaced and confirmed the fix for refund
  transaction-rollback described in §5.
- **Backup regression (Part 18):** post-move snapshot-mode backup to `hdd2`
  completed (exit OK, ~822 MB) with the paid snapshot intact.
- **Idempotency:** re-paying an already-paid order with the same
  `billable:${orderId}` key returns `reused` without a second debit.
- Current ledger: 1 paid + 2 refunded snapshot charges (₹70.80 charged,
  ₹47.20 refunded), wallet balance 241.58, no charges pending refund.