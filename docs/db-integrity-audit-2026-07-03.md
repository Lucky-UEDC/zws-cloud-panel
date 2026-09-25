# MYRDPHUB DB Integrity Audit - 2026-07-03

Mode: apply
Backup: skipped

| Area | Check | Severity | Count | Repair |
| --- | --- | --- | ---: | --- |
| schema | Unvalidated foreign-key constraints | critical | 0 |  |
| schema | Required api_keys table missing | critical | 0 |  |
| customers | Duplicate customers by case-insensitive email | critical | 0 |  |
| orders | Orders with missing customer | critical | 0 |  |
| orders | Deleted orders missing hidden flags | critical | 0 | Run with --apply to normalize deleted order flags. |
| orders | Active paid orders without VPS or dedicated service | warning | 0 |  |
| invoices | Service invoices without an order | critical | 0 | Run with --apply to link service invoices to their completed payment order when unambiguous. |
| invoices | Invoices with missing customer | critical | 0 |  |
| invoices | Invoices linked to missing orders | critical | 0 |  |
| revenue | Paid service invoices counted against deleted/inactive orders | critical | 0 | Run with --apply to soft-hide paid service invoices tied to deleted/inactive orders. |
| invoices | Invoices with invalid totals | warning | 0 |  |
| payments | Payments linked to missing invoices | warning | 0 |  |
| payments | Payments linked to missing orders | warning | 0 |  |
| services | VPS records with missing orders | critical | 0 |  |
| services | VPS records with missing customers | critical | 0 |  |
| services | Deleted VPS records missing deletedAt | warning | 0 | Run with --apply to normalize deleted VPS flags. |
| services | Dedicated services with missing orders | critical | 0 |  |
| ipam | IP allocations with missing pool | critical | 0 |  |
| ipam | IP allocations linked to missing VPS | warning | 0 |  |
| ipam | Assigned/reserved IPs attached to deleted VPS records | critical | 0 | Run with --apply to release IP allocations attached to deleted VPS records. |
| ipam | Duplicate active IP allocation rows | critical | 0 |  |
| ipam | Duplicate public IPs on active VPS rows | critical | 0 |  |
| ipam | Active VPS IPs without an active allocation | critical | 3 | Assigned uniquely matching free allocation rows; unmatched IPs require pool review. (3 changed) |
| services | Duplicate VMIDs on active VPS rows | critical | 0 |  |
| provisioning | Active VPS rows without provisioning identity | critical | 0 | Backfill canonical identities from active VPS/order records. |
| provisioning | Duplicate active provision jobs per order and type | critical | 0 |  |
| payments | Duplicate successful gateway transaction IDs | critical | 0 |  |
| network | VM network interfaces with missing VPS | warning | 0 |  |
| network | VM IP assignments with missing VPS | warning | 0 |  |
| network | Recent duplicate network repair/confirmation events | warning | 0 | Run with --apply to delete duplicate repair/confirmation spam while keeping the newest event per VM/hour/status. |
| revenue | Coupon redemptions with missing coupon | warning | 0 |  |
| revenue | Coupon redemptions with missing customer | warning | 0 |  |
| notifications | Notification logs with metadata customerId linked to missing customers | warning | 0 |  |
| analytics | Analytics events with customer userId linked to missing customers | info | 0 |  |
| whatsapp | Evolution API database configuration rows | info | 2 |  |

## Remaining Manual Blockers

- None detected by critical checks.

Repairs are intentionally limited to idempotent visibility, revenue exclusion, and IP-release fixes where the target state is unambiguous.
