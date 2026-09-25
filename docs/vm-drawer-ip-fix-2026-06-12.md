# VM Drawer, IP Inventory, And Live Action Verification - 2026-06-12

## Scope

This follow-up fixed the over-compacted VM drawer, restored always-visible admin operations, repaired IP pool assignment joins, and verified live VM actions against the PM2-served app.

## Missing Or Broken Features Found

| Area | Finding | Fix |
| --- | --- | --- |
| VM drawer actions | Common actions were hidden behind tabs or dropdowns instead of staying visible. | Added sticky drawer action bar with Console, Start, Stop, Restart, Change IP, Reinstall, Extend Service, Billing, and Delete. |
| Drawer URL state | Detail drawer could remain selected after close/back flows. | Drawer open uses `/admin/vms?vm=<id>` and close flows clear selection back to `/admin/vms` without reload. |
| Reinstall dialog | The queue button could land outside the viewport. | Bounded the reinstall modal to `92vh`, made the form scrollable, and added a sticky submit footer. |
| IP inventory | Node name, VMID, hostname, customer, assigned date, and last changed could show `-` despite related rows. | Merged `VmIpAssignment`, `IpAllocation`, `VpsInstance`, `ProxmoxNode`, `IpPool.proxmoxNode`, `Order`, and `Customer` data. |
| Available IP list | IPs that were active on VM assignments could be exposed as available if allocation rows were stale. | Excluded active VM assignment IPs, active VM `ipAddress` values, and assigned/used allocation rows. |
| Change IP finalization | The primary VM row could stay stale after a successful assignment change. | Finalized `vps_instances.ipAddress` after successful network orchestration hooks. |

## Routes And Interfaces

| Route | Result |
| --- | --- |
| `/admin/vms` | Compact VM table plus sticky action drawer verified. |
| `/admin/vms?vm=<id>` | Deep link opens drawer; X, ESC, outside click, and Back close to `/admin/vms`. |
| `/api/admin/vms/[id]/actions` | Start, Stop, Restart, and Reinstall verified live. |
| `/api/admin/vms/[id]/network/change-primary-ip` | Validate/apply Change IP flow verified live. |
| `/api/admin/ip-pools` | Assignment serialization and available-IP exclusions verified. |
| `/api/admin/ip-pools/[id]/allocations` | Pool-detail assignment serialization updated with the same join logic. |

## Live Target

| Field | Value |
| --- | --- |
| VM ID | `cmq9qhd7p01xhpjwlle18r3zi` |
| VMID | `139` |
| Hostname | `zws.zp2-medium.sonukhan1-1` |
| Customer | `Sonukhan1` |
| Node | `pve` |
| Old IP | `162.141.0.66` |
| New IP | `162.141.0.67` |
| Assigned Date | `2026-06-12T14:48:41.891Z` |
| Last Changed | `2026-06-12T14:48:41.892Z` |

## Live Playwright Result

Command:

```bash
PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npx playwright test scripts/tests/unit/vm-drawer-ip-live.spec.ts --project=chromium --reporter=line
```

Result: `1 passed (2.0m)`.

Verified:

- Row/direct drawer open.
- X, ESC, outside click, and browser Back close flows.
- Sticky action bar remains visible while switching tabs.
- Real Change IP from `162.141.0.66` to `162.141.0.67`.
- IP inventory row includes VMID, hostname, node name, node ID, customer, assigned date, and last changed.
- Real Start, Stop, Start, Restart action sequence.
- Reinstall validation and queue action from the visible action bar.

## Screenshots And Artifacts

Stored under `test-artifacts/vm-drawer-ip-fix-2026-06-12/`:

- `vm-drawer-action-bar.png`
- `drawer-tabs-action-bar-sticky.png`
- `drawer-closed-list.png`
- `change-ip-validated.png`
- `change-ip-applied.png`
- `ip-pool-inventory-after.png`
- `power-actions-complete.png`
- `reinstall-validation.png`
- `reinstall-queued.png`
- `target.json`
- `ip-inventory-after.json`

## Build And Release

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `NODE_OPTIONS=--no-deprecation node --import tsx --test scripts/tests/unit/vm-drawer-ip-inventory.test.ts` | Passed |
| `pnpm lint` | Passed with pre-existing image optimization warnings only |
| `pnpm db:validate:migrations` | Passed |
| `pnpm audit:routes` | Passed |
| `pnpm build` | Passed with known noVNC top-level-await warning |
| PM2 release | `/var/www/myrdphub/releases/20260612-144700-vm-drawer-ip-reinstall-modal` |
| Cloudflare purge | Skipped; purge credentials were not configured in the local environment |
