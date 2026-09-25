# Production VPS Reconciliation Report

Date: 2026-07-04 UTC

## Implementation

- Added `lib/production-vps-reconciliation.ts` as the shared, locked reconciliation engine.
- Added `scripts/reconcile-production-vps.ts` with `--dry-run`, `--apply`, `--report`, `--limit`, and `--vps-id`.
- Replaced the database-first sync worker implementation with the shared engine.
- Kept customer and admin page-load status/metrics paths database-first.
- Reconciliation calls Proxmox only with `nodeName + vmid`.
- Reconciliation never creates VPS rows or IP pools and reports duplicate VM/IP ownership instead of guessing.
- The worker is supervised by `workers/zws-worker.ts` and runs every five minutes.

## Production Apply

Report: `deployment-reports/production-vps-reconciliation-2026-07-04-apply/report.json`

| Result | Count |
| --- | ---: |
| VPS scanned | 52 |
| VPS refreshed/repaired | 52 |
| IP records repaired | 7 |
| Monitoring caches repaired | 52 |
| Disk records repaired | 52 |
| Network caches repaired | 52 |
| Activity errors cleared | 0 |
| Missing VMs marked | 0 |
| Duplicate VMID mappings | 0 |
| Duplicate IP conflicts | 2 records / 1 IP |
| Remaining failures | 2 |

## Post-Apply Validation

- Missing `vm_runtime`: 0
- Missing `vm_metrics_cache`: 0
- Missing `vm_network_cache`: 0
- Missing configured disk: 0
- Active panel/runtime status mismatches: 0
- Order `assigned_ip_missing_in_database` errors: 0
- Provisioning job `assigned_ip_missing_in_database` errors: 0
- Duplicate panel `VpsInstance.ipAddress` values: 0
- VPS rows without `ipAddress`: 1

Running VMs with an unavailable guest agent are recorded as `guest_agent_offline`, not `Server Offline`. Their configured disk size remains available with usage marked unavailable.

## Remaining Production Conflict

The IP `151.243.146.51` is configured in Proxmox and actively assigned to two panel services:

- VMID 144, node `pve`, VPS `cmpydczs20057pjf0nd8rxmv8`
- VMID 200, node `pve`, VPS `cmq9qhd7p01xhpjwlle18r3zi`

Both VM configurations claim the same address, so automatic ownership selection would risk taking a live service offline. The reconciler leaves the IP field for VMID 144 unset and reports the conflict. An administrator must select a replacement IP for one VM, update its Cloud-Init configuration, and rerun `pnpm vm:reconcile:apply`.

## Verification

- Focused VMID lifecycle/reconciliation tests: passed, 5/5.
- TypeScript: `pnpm typecheck` passed.
- Full suite: latest run passed 122 tests and failed 12 unrelated stale contracts/fixtures.
- Known full-suite failures include missing historical UI/API files, a missing historical migration fixture, stale Docker/WhatsApp/IPAM/payment assertions, and a 30-second status-cache expectation against the current 90-second setting.

## Staging Lifecycle Run

The destructive 20-VM staging lifecycle run was not executed because no dedicated test node, template, or pool was supplied. It must not run without all of:

- `RECONCILE_TEST_NODE_ID`
- `RECONCILE_TEST_TEMPLATE_VMID`
- `RECONCILE_TEST_POOL_ID`

No production VM was created, deleted, reinstalled, suspended, or rebooted for acceptance testing.
