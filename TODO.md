# ZWS Cloud Production Rework — Post-Deployment TODO

**Branch:** `feat/disk-telemetry-revenue` → ready for fast-forward to `main`
**Deployed:** ✅ All containers healthy with new build (`zws-cloud:latest`)

---

## ✅ Completed (Deployed & Verified)

| Phase | Component | Status |
|---|---|---|
| 1 | Disk Telemetry Foundation | ✅ Deployed |
| 2 | Client Metrics APIs + Freshness | ✅ Deployed |
| 3 | Admin VM Metrics Diagnostics | ✅ Deployed |
| 4 | Revenue Analytics Redesign | ✅ Deployed |
| Gates | Typecheck / Tests / Build | ✅ All pass |

---

## 🔄 Remaining Follow-up Tasks

### 1. Live E2E Verification (Production)
- [ ] **VMID 114 (Linux)** — Verify guest exec `df -B1 -P` returns valid disk usage, CURRENT freshness badge
- [ ] **Windows VM** — Verify PowerShell `Get-CimInstance` + wmic fallback returns selected C: drive, CURRENT badge
- [ ] **Stopped VM** — Verify "Server stopped" state, UNAVAILABLE disk freshness, last-known values retained
- [ ] **No-agent VM** — Verify `GUEST_AGENT_DISABLED` errorCode, "Guest agent unavailable" message, no 0 values shown
- [ ] **Admin Diagnostics Page** — Verify `/admin/vms/[id]` shows Metrics Diagnostics section with volumes, last check, error codes
- [ ] **Revenue Page** — Verify `/admin/revenue` loads with all 12 KPI cards, filters apply to charts+tables+exports, CSV/Excel/PDF work

### 2. Database Migration (Additive Only)
- [ ] **Optional Revenue Indexes** — `CREATE INDEX IF NOT EXISTS ON payments (gateway, status, completedAt)` for query performance
- [ ] **VpsMetric Retention** — Add migration for 48h raw / 90d hourly rollup (mirror `nodeMetric` → `nodeMetricHourly` pattern)
- [ ] **VmUsageHistory Cleanup** — Add FK to VpsInstance or repurpose as hourly rollup table

### 3. Git & Release
- [ ] **Fast-forward `main`** — `git checkout main && git merge feat/disk-telemetry-revenue --ff-only`
- [ ] **Tag Release** — `git tag v1.1.0-disk-telemetry-revenue`
- [ ] **Push** — `git push origin main --tags`

### 4. Monitoring & Alerting
- [ ] **Worker Health Alerts** — Add alerts for vm-telemetry-worker stall (>5min no tick), disk collection failure rate spike
- [ ] **Freshness SLO** — Dashboard for % VMs with CURRENT disk freshness (target >95%)
- [ ] **Revenue Reconciliation** — Daily job comparing API revenue totals vs ledger totals

### 5. Documentation
- [ ] **Architecture Decision Record** — Document CURRENT/STALE/UNAVAILABLE freshness model
- [ ] **API Changelog** — Document new `/metrics/current` and `/metrics-diagnostics` endpoints
- [ ] **Revenue Definitions** — Publish Gross/Net/Collected/Fees/GST/Refunds/Top-up formulas in internal wiki

---

## 📋 Quick Verification Commands

```bash
# Check all containers healthy
docker compose ps

# Verify new API endpoints
curl -I http://localhost:13000/api/admin/revenue
curl -I http://localhost:13000/api/client/vps/114/metrics/current

# Check worker telemetry collection
docker logs myrdphub-worker-1 -f | grep "vm-telemetry-worker"

# Verify revenue exports
curl "http://localhost:13000/api/admin/revenue?format=csv" -H "Cookie: <admin-session>"

# Verify Excel export is real SpreadsheetML
curl "http://localhost:13000/api/admin/revenue?format=excel" -H "Cookie: <admin-session>" -o revenue.xls
file revenue.xls  # Should show "XML document"
```

---

## 🔗 Key Files for Review

| Area | Files |
|---|---|
| Disk Collector | `lib/vm-guest-disk.ts`, `lib/vm-os-detection.ts` |
| Worker | `scripts/vm-telemetry-worker.ts` |
| Client APIs | `lib/vm-db-truth.ts`, `app/api/client/vps/[id]/metrics/current/route.ts` |
| Client UI | `app/client-area/vps/[id]/page.tsx`, `components/client/vps-live-usage-charts.tsx` |
| Admin Diagnostics | `app/api/admin/vms/[id]/metrics-diagnostics/route.ts`, `app/admin/vms/[id]/page.tsx` |
| Revenue | `lib/revenue-analytics.ts`, `app/api/admin/revenue/route.ts`, `lib/admin-export.ts`, `app/admin/revenue/page.tsx` |
| Tests | `scripts/tests/unit/vm-guest-disk-telemetry.test.ts` |

---

**Generated:** $(date)
**Branch:** feat/disk-telemetry-revenue
**Base:** fbe0623 (next == main)