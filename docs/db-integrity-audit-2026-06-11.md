# MYRDPHUB DB Integrity Audit - 2026-06-11

Mode: dry-run

| Check | Severity | Count | Repair |
| --- | --- | ---: | --- |
| Orders with missing customer | critical | 0 |  |
| Invoices with missing customer | critical | 0 |  |
| Invoices linked to missing orders | critical | 0 |  |
| Payments linked to missing invoices | warning | 0 |  |
| Payments linked to missing orders | warning | 0 |  |
| Paid service invoices counted against deleted/inactive orders | critical | 0 |  |
| Deleted orders missing hidden flags | critical | 0 | Run with --apply to set deletedAt and isActive=false for status=DELETED orders. |
| VPS records with missing orders | critical | 0 |  |
| VPS records with missing customers | critical | 0 |  |
| Deleted VPS records missing deletedAt | warning | 0 | Run with --apply to set deletedAt/deletionAt for status=DELETED VPS rows. |
| IP allocations with missing pool | critical | 0 |  |
| IP allocations linked to missing VPS | warning | 0 |  |
| Assigned/reserved IPs attached to deleted VPS records | critical | 0 | Run with --apply to release IP allocations attached to deleted VPS records. |
| VM network interfaces with missing VPS | warning | 0 |  |
| VM IP assignments with missing VPS | warning | 0 |  |
| VM network events with missing VPS | warning | 0 |  |
| Coupon redemptions with missing coupon | warning | 0 |  |
| Coupon redemptions with missing customer | warning | 0 |  |
| Duplicate active IP allocation rows | critical | 0 |  |
| Active paid orders without VPS or dedicated service | warning | 0 |  |
| Evolution API configuration rows | info | 4 |  |

Repairs are intentionally limited to idempotent visibility/IP-release fixes where the target state is unambiguous.
