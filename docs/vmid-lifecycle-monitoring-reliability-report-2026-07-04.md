# VMID Lifecycle And Monitoring Reliability Report

Date: 2026-07-04

## Files Changed

- `lib/vps-control.ts`
- `lib/vm-db-truth.ts`
- `app/api/admin/proxmox/vms/[vmid]/action/route.ts`
- `app/api/admin/vps/[id]/action/route.ts`
- `app/api/client/vps/[id]/action/route.ts`
- `app/api/client/vps/[id]/status/route.ts`
- `app/api/client/vps/[id]/metrics/route.ts`
- `app/api/client/vps/[id]/bandwidth/route.ts`
- `app/api/v1/vms/[id]/power/route.ts`
- `app/client-area/vps/[id]/page.tsx`
- `scripts/database-first-proxmox-sync-worker.ts`
- `workers/zws-worker.ts`
- `scripts/tests/unit/vmid-lifecycle-monitoring-reliability.test.ts`
- `docs/vmid-lifecycle-monitoring-reliability-report-2026-07-04.md`

## API Changes

- Admin VMID action route now delegates lifecycle work to the shared VM action service instead of calling Proxmox directly.
- VM action responses now include VM identity fields where available: `vpsInstanceId`, `proxmoxNodeId`, `node`, `vmid`, `runtimeStatus`, `status`, and `taskId`.
- VM action failures now include stable error codes such as `VM_MISSING`, `VMID_MISSING`, `NODE_MISSING`, `NODE_INACTIVE`, `VM_NOT_RUNNING`, and `VM_NOT_STOPPED`.
- Customer status and metrics page-load APIs are database-first. They read cached runtime/metric data and no longer call Proxmox during page loads.

## Database Migrations

- No Prisma migration was added.
- Existing schema already contains the required VM identity, runtime cache, metric cache, IP assignment, IP history, and audit models used by this fix.

## Monitoring Fixes

- Running VMs no longer rely on guest-agent availability to avoid an offline label.
- Customer UI distinguishes:
  - stopped VM: `Server offline`
  - running VM with stale or missing telemetry: `Monitoring unavailable`
  - running VM with guest-agent gap recorded by the worker: `Guest agent offline`
  - running VM with no network sample: `No traffic sample`
  - disk capacity known but filesystem usage missing: `Usage unavailable`
- Disk capacity now falls back to configured VM/runtime/product/disk records so configured size can still display when guest-agent filesystem usage is unavailable.
- Metrics freshness now uses `UNAVAILABLE` for monitoring gaps instead of treating missing telemetry as VM offline.

## VM Action Fixes

- Shared VM power control validates database row, positive VMID, active node config, and Proxmox VM existence before action.
- Missing Proxmox VMs are marked `MISSING` and returned with `VM_MISSING`.
- Start uses `nodeName + vmid`, preserves Cloud-Init self-heal before start, and polls for `running`.
- Stop uses the existing VMID-only robust path: shutdown, stop, unlock/stop, node-level QEMU PID kill, final status check.
- Restart uses the existing VMID-only robust path: reboot with reset fallback.
- Legacy admin VPS action route no longer maps `forceStop` to a separate `force_kill` branch before shared control.

## Sync Worker

- Restored `scripts/database-first-proxmox-sync-worker.ts`.
- Added it to `workers/zws-worker.ts`.
- The worker runs every 5 minutes by default and matches only by `proxmoxNodeId + vmid`.
- It updates existing VPS rows, runtime cache, metrics, configured resources, IP metadata, and marks missing Proxmox guests as `MISSING`.
- It does not create VPS records, does not delete IP pools, and preserves database primary IPs if guest-agent IPs disagree.

## Test Results

- PASS: `NODE_OPTIONS=--no-deprecation node --import tsx --test --test-concurrency=1 --test-force-exit scripts/tests/unit/vmid-lifecycle-monitoring-reliability.test.ts`
- PASS: `pnpm typecheck`
- PARTIAL FAIL: `pnpm test`
  - New VMID reliability tests pass inside the full suite.
  - The full suite still fails on unrelated stale/missing contracts, including missing `components/client/vps/vps-detail-client.tsx`, missing `app/api/client/vps/[id]/addons/route.ts`, a stale Docker entrypoint assertion, a stale `VM_STATUS_CACHE_TTL_MS` expectation, and a missing historical migration fixture.

## 20 Scenario Staging VM Run

Not run in this workspace.

Reason: the implementation plan requires a dedicated staging Proxmox node/pool with safe credentials and cleanup permission. This session did not provide an explicitly safe staging pool for creating, rebooting, reinstalling, suspending, deleting, and destroying 20 real VMs.

Required staging scenarios remain:

- Start
- Stop
- Restart
- Console
- Monitoring
- Reinstall
- Suspend
- Unsuspend
- Delete
- Sync
- Guest agent off
- Guest agent on
- Reboot host
- Restart worker
- Restart panel
- Restart API
- VM missing
- IP reconciliation
- Disk unavailable fallback
- Network no-sample fallback
