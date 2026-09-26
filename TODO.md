# ZWS Cloud — Master Task List (live tracking)

Status legend: `DONE` (verified on the running system this session) · `OPEN` · `IN PROG` · `CODE` (implemented, not yet verified on the running system)

## Phase 0 — Previously verified (DONE, kept)
- [x] A. Payment gateway explicit-selection routing (preferredGateway wins; priority only for automatic; failsafe gated; returned-gateway validation) — lib/payments/gateway-selection.ts, domain-gateway-resolver.ts
- [x] B. Backup usage reconciliation (rebuildBackupUsage → backup_usage ledger: 11 backups, 22,135,435,966 B, 100 GB quota)
- [x] C. Client UI infra leak removal (node/storage/disk hidden from client pages)
- [x] D. Production multi-stage Docker image (zws-cloud:1.1.0 = 30e563b2b5d6, immutable tags, healthcheck, non-root)
- [x] E. GitHub Update Center (private repo Lucky-UEDC/zws-cloud-panel, v0.0.1 trusted manifest, preflight/apply/lock/deploy ledger)
- [x] Deploy: migrate → up -d --build → docker-tag.sh; all services healthy; memory ≈ 3.0 GiB (< 8 GB)

## Phase 1 — Client backup page hardening (CODE, verified gates)
- [x] 1.1 Add client **Delete** action for completed backups (backend route + confirm dialog + usage recalculation + audit `backup_deleted` / `backup_delete_failed`) — app/api/client/backups/[id]/delete/route.ts + backups page
- [x] 1.2 Stop exposing archive `fileName`/artifact path to the client (details dialog + API payload) — backups route `fileName: null`, clientBackupRow drops archive, page type cleaned
- [x] 1.3 Server selector uses friendly label + IP (use displayTag once 2.x lands; no internal vmId as primary label) — friendlyVmDisplayName; instanceDisplayName no longer falls back to vmid/id
- [x] 1.4 Error state ≠ empty state: keep explicit "Unable to load backups + Retry" when API fails — backups page

## Phase 2 — Server Tag / displayTag (CODE, verified gates)
- [x] 2.1 Additive migration: `VpsInstance.displayTag` (+ backfill from friendly name; never touch hostname) — prisma/migrations/20260925000001_display_tag (APPLIED in live deploy, migration #157)
- [x] 2.2 Checkout: remove editable **Hostname** field → optional **Server Tag**; hostname auto-assigned from public IP (`ip-A-B-C-D`) at provisioning — CheckoutContent + checkout-bootstrap + payments/create displayTag wiring (live SSR verified: "Server Tag (optional)" rendered)
- [x] 2.3 VM list + VM card: displayTag primary, IP visible, hostname only in "Technical details" — client vps route + serializeClientVmStatus + vps pages
- [x] 2.4 VM settings: edit Server Tag only (no hostname/VM/restart change) + audit `server_tag_changed` — app/api/client/vps/[id]/tag/route.ts + vps detail page
- [x] 2.5 Backup history + dropdowns consume displayTag — backups route + vm-context route

## Phase 3 — Credit auto-payment UI (CODE, verified gates; backend wallet payment already exists in /api/payments/create)
- [x] 3.1 Checkout bootstrap returns authoritative wallet balance (server-side, from session) — lib/checkout-bootstrap.ts `clientWalletBalance()` → `walletBalance`
- [x] 3.2 Checkout payment section: Account Credit option (default when credit >= final payable), gateway radios kept — CheckoutContent paymentMethod + auto-select effect
- [x] 3.3 Button label logic: "Buy with Credit" / "Continue with <Gateway>"; credit insufficient → disabled + not-enough message — submit button + creditEligible guard
- [x] 3.4 Submit `paymentMethod: "wallet"` — no gateway initialized; returned-gateway validation accepts `wallet` — preferredGateway only in gateway mode; wallet branch skips startPaymentRedirect
- [x] 3.5 Receipt: Credit used + remaining balance (never a gateway TXN id) — wallet path → firstPaymentString(redirectUrl) || /client-area/billing?tab=invoices

## Phase 4 — Tests + quality gates (DONE this build)
- [x] 4.1 Unit: hostname generation, server tag, credit eligibility (exact/insufficient/sufficient), credit atomicity, backup delete, backup API error vs empty state, progress-100 regression — new scripts/tests/unit/server-tag-credit-identity.test.ts (26 tests) + updated payment-gateway-flow-contract test
- [x] 4.2 pnpm typecheck · lint · test · build — tsc clean, eslint clean, 401/401 tests pass, next build OK
- [x] 4.3 docker compose build + up -d (migrate first), health + memory re-check — deployed live (zws-cloud:1.1.0, image ca. 2.9 GiB)

## Phase 5 — Live E2E (DONE, verified this session)
- [x] 5.1 Live backup delete test (VM 465543, backup `…1789363108986`): validations 400/400/404/401; real DELETE → artifact deleted (Proxmox), usage 22,096,748,655 → 21,300,262,759 (−796,485,896 exact), count 11 → 10; row → cancelled + `deletedByCustomer` metadata; audit `backup_deleted` COMPLETED; API reflects cancelled
- [x] 5.2 Credit purchase E2E (wallet ₹241.58): wallet-settle ₹234.82 billable order → 200 paid, `gateway:"wallet"`, `gatewayAmount:0`, no gateway URL, `walletAppliedAmount:234.82` exact; balance 241.58 → 6.76; ledger tx `balanceBefore/After` exact; order+invoice paid. Insufficient (₹234.82 > ₹6.76) → 400 `wallet_insufficient`, no debit, order stays pending, no new ledger row. Exact boundary covered by same `gte` predicate + exact-debit ledger arithmetic
- [x] 5.3 Server tag visible end-to-end: checkout renders "Server Tag (optional)"; PATCH create "ZWS E2E Server" → edit "ZWS Prod Web 01" persists in list + `/status` detail; pure emoji → 400, mixed sanitized, empty clears; hostname canonical (`ip-103-216-170-230`), `vmid`/`nodeName`/`node` = null; backup page selector shows friendly label + IP; no fileName/archive leak (ROW COUNT 109 → 10 completed)
- [x] 5.4 Fix found during E2E: `GET /api/client/backups` BigInt 500 (remainingBytes) — normalizeUsageJson now BigInt-safe (JSON.stringify replacer); dispatched via rebuild