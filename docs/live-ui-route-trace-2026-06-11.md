# MYRDPHUB Live UI Route Trace - 2026-06-11

This report maps each live admin surface to its page, navigation entry, API calls, service layer, and database models.

Production PM2 apps serve `/var/www/myrdphub`; deploys update the single production codebase only after backup and validation.

| Surface | Browser URL | Page component | Sidebar entry | API calls | Service functions/files | DB models |
| --- | --- | --- | --- | --- | --- | --- |
| Dashboard | `/admin` | `app/admin/page.tsx` | Dashboard | `/api/admin/dashboard`, `/api/admin/revenue` | `lib/admin-dashboard.ts`, `lib/revenue-analytics.ts` | `Order`, `Invoice`, `Payment`, `VpsInstance`, `Customer`, `CouponRedemption` |
| Customers | `/admin/customers, /admin/customers/[id]` | `app/admin/customers/page.tsx, app/admin/customers/[id]/page.tsx` | Customers > Customers | `/api/admin/customers`, `/api/admin/customers/[id]` | `lib/revenue-analytics.ts`, `lib/checkout-identity.ts` | `Customer`, `Order`, `Invoice`, `Payment`, `WalletTransaction`, `SupportTicket` |
| Orders | `/admin/orders, /admin/orders/new` | `app/admin/orders/page.tsx, app/admin/orders/new/page.tsx` | Customers > Orders | `/api/admin/orders/with-vm-status`, `/api/admin/orders/[id]`, `/api/admin/orders/bulk` | `lib/vps-lifecycle.ts`, `lib/provision.ts`, `lib/revenue-analytics.ts` | `Order`, `Invoice`, `Payment`, `VpsInstance`, `ProvisioningJob`, `IpAllocation` |
| Invoices | `/admin/invoices` | `app/admin/invoices/page.tsx` | Payments > Invoices | `/api/admin/invoices`, `/api/admin/invoices/[id]`, `/api/admin/invoices/bulk` | `lib/invoice-deletion.ts`, `lib/invoices.ts`, `lib/revenue-analytics.ts` | `Invoice`, `Payment`, `PaymentAttempt`, `PaymentGatewayAttempt`, `Order` |
| Revenue | `/admin/revenue` | `app/admin/revenue/page.tsx` | Payments > Revenue | `/api/admin/revenue` | `lib/revenue-analytics.ts` | `Invoice`, `Payment`, `Order`, `VpsInstance`, `DedicatedService`, `CouponRedemption` |
| Coupons | `/admin/coupons, /admin/coupons/[id]` | `app/admin/coupons/page.tsx, app/admin/coupons/[id]/page.tsx` | Products & Sales > Coupons | `/api/admin/coupons`, `/api/admin/coupons/[id]` | `lib/coupons.ts` | `Coupon`, `CouponRedemption`, `Product`, `ProductGroup` |
| VMs | `/admin/vms, /admin/vms/[id]` | `app/admin/vms/page.tsx, app/admin/vms/[id]/page.tsx` | Infrastructure > Virtual Machines | `/api/admin/vms`, `/api/admin/vms/[id]`, `/api/admin/vms/[id]/network`, `/api/admin/vms/[id]/delete` | `lib/admin-vm-management.ts`, `lib/vm-deletion.ts`, `lib/vm-network-orchestrator.ts` | `VpsInstance`, `Order`, `ProxmoxNode`, `VmNetworkInterface`, `VmIpAssignment`, `VmNetworkEvent`, `IpAllocation` |
| Console | `/admin/vms/[id]/console` | `app/admin/vms/[id]/console/page.tsx` | Virtual Machines row/detail action | `/api/admin/vms/[id]/console/session`, `/api/admin/vms/[id]/console/resize`, `/api/admin/vms/[id]/console/ctrl-alt-del` | `lib/console-session.ts`, `lib/console-mode.ts`, `lib/console-resolution.ts`, `lib/proxmox-vnc.ts` | `VpsInstance`, `Order`, `OsTemplate`, `ProxmoxNode` |
| Templates | `/admin/os-templates` | `app/admin/os-templates/page.tsx` | Infrastructure > Operating Systems | `/api/admin/os-templates`, `/api/admin/os-templates/[id]`, `/api/admin/os-templates/sync` | `lib/os-template-availability.ts`, `lib/os-template-normalization.ts` | `OsTemplate`, `ProxmoxNode` |
| IP Pools | `/admin/ip-pools, /admin/ip-pools/[id]` | `app/admin/ip-pools/page.tsx, app/admin/ip-pools/[id]/page.tsx` | Infrastructure > IP Pools | `/api/admin/ip-pools`, `/api/admin/ip-pools/[id]`, `/api/admin/ip-pools/[id]/allocations` | `lib/ip-pool.ts`, `lib/ipam-admin.ts`, `lib/vm-network-orchestrator.ts` | `IpPool`, `IpPoolRange`, `IpAllocation`, `VmIpAssignment`, `VmNetworkInterface`, `VmNetworkEvent` |
| Backups | `/admin/backups` | `app/admin/backups/page.tsx` | System > Backups | `/api/admin/backups`, `/api/admin/backups/upload`, `/api/admin/backups/[id]/restore`, `/api/admin/backups/[id]/restore-test` | `lib/backups.ts`, `lib/backup-health.ts`, `lib/google-drive-backup.ts` | `BackupRun`, `BackupDestination`, `BackupRestoreTest`, `RuntimeIntegration` |
| Notifications | `/admin/notifications, /admin/notifications/logs` | `app/admin/notifications/page.tsx, app/admin/notifications/logs/page.tsx` | Communication > Notifications | `/api/admin/notifications/settings`, `/api/admin/notifications/logs` | `lib/notifications/service.ts`, `lib/email/send.ts`, `lib/whatsapp/send.ts` | `NotificationDeliveryLog`, `EmailLog`, `WhatsAppMessageLog`, `CustomerNotificationPreference` |
| WhatsApp | `/admin/whatsapp` | `app/admin/whatsapp/page.tsx` | Communication > WhatsApp | `/api/admin/whatsapp/status`, `/api/admin/whatsapp/health`, `/api/admin/whatsapp/send`, `/api/admin/whatsapp/test-message` | `lib/whatsapp/evolution.ts`, `lib/whatsapp/send.ts`, `lib/whatsapp/queue.ts` | `RuntimeIntegration`, `WhatsAppMessageLog`, `WhatsAppCampaign`, `WhatsAppCampaignLog` |

## Dashboard

- Browser URL: `/admin`
- Page component: `app/admin/page.tsx`
- Sidebar entry: Dashboard
- API calls: `/api/admin/dashboard`, `/api/admin/revenue`
- Service functions/files: `lib/admin-dashboard.ts`, `lib/revenue-analytics.ts`
- DB models: `Order`, `Invoice`, `Payment`, `VpsInstance`, `Customer`, `CouponRedemption`

## Customers

- Browser URL: `/admin/customers, /admin/customers/[id]`
- Page component: `app/admin/customers/page.tsx, app/admin/customers/[id]/page.tsx`
- Sidebar entry: Customers > Customers
- API calls: `/api/admin/customers`, `/api/admin/customers/[id]`
- Service functions/files: `lib/revenue-analytics.ts`, `lib/checkout-identity.ts`
- DB models: `Customer`, `Order`, `Invoice`, `Payment`, `WalletTransaction`, `SupportTicket`

## Orders

- Browser URL: `/admin/orders, /admin/orders/new`
- Page component: `app/admin/orders/page.tsx, app/admin/orders/new/page.tsx`
- Sidebar entry: Customers > Orders
- API calls: `/api/admin/orders/with-vm-status`, `/api/admin/orders/[id]`, `/api/admin/orders/bulk`
- Service functions/files: `lib/vps-lifecycle.ts`, `lib/provision.ts`, `lib/revenue-analytics.ts`
- DB models: `Order`, `Invoice`, `Payment`, `VpsInstance`, `ProvisioningJob`, `IpAllocation`

## Invoices

- Browser URL: `/admin/invoices`
- Page component: `app/admin/invoices/page.tsx`
- Sidebar entry: Payments > Invoices
- API calls: `/api/admin/invoices`, `/api/admin/invoices/[id]`, `/api/admin/invoices/bulk`
- Service functions/files: `lib/invoice-deletion.ts`, `lib/invoices.ts`, `lib/revenue-analytics.ts`
- DB models: `Invoice`, `Payment`, `PaymentAttempt`, `PaymentGatewayAttempt`, `Order`

## Revenue

- Browser URL: `/admin/revenue`
- Page component: `app/admin/revenue/page.tsx`
- Sidebar entry: Payments > Revenue
- API calls: `/api/admin/revenue`
- Service functions/files: `lib/revenue-analytics.ts`
- DB models: `Invoice`, `Payment`, `Order`, `VpsInstance`, `DedicatedService`, `CouponRedemption`

## Coupons

- Browser URL: `/admin/coupons, /admin/coupons/[id]`
- Page component: `app/admin/coupons/page.tsx, app/admin/coupons/[id]/page.tsx`
- Sidebar entry: Products & Sales > Coupons
- API calls: `/api/admin/coupons`, `/api/admin/coupons/[id]`
- Service functions/files: `lib/coupons.ts`
- DB models: `Coupon`, `CouponRedemption`, `Product`, `ProductGroup`

## Virtual Machines

- Browser URL: `/admin/vms, /admin/vms/[id]`
- Page component: `app/admin/vms/page.tsx, app/admin/vms/[id]/page.tsx`
- Sidebar entry: Infrastructure > Virtual Machines
- API calls: `/api/admin/vms`, `/api/admin/vms/[id]`, `/api/admin/vms/[id]/network`, `/api/admin/vms/[id]/delete`
- Service functions/files: `lib/admin-vm-management.ts`, `lib/vm-deletion.ts`, `lib/vm-network-orchestrator.ts`
- DB models: `VpsInstance`, `Order`, `ProxmoxNode`, `VmNetworkInterface`, `VmIpAssignment`, `VmNetworkEvent`, `IpAllocation`

## Console

- Browser URL: `/admin/vms/[id]/console`
- Page component: `app/admin/vms/[id]/console/page.tsx`
- Sidebar entry: Virtual Machines row/detail action
- API calls: `/api/admin/vms/[id]/console/session`, `/api/admin/vms/[id]/console/resize`, `/api/admin/vms/[id]/console/ctrl-alt-del`
- Service functions/files: `lib/console-session.ts`, `lib/console-mode.ts`, `lib/console-resolution.ts`, `lib/proxmox-vnc.ts`
- DB models: `VpsInstance`, `Order`, `OsTemplate`, `ProxmoxNode`

## Operating Systems

- Browser URL: `/admin/os-templates`
- Page component: `app/admin/os-templates/page.tsx`
- Sidebar entry: Infrastructure > Operating Systems
- API calls: `/api/admin/os-templates`, `/api/admin/os-templates/[id]`, `/api/admin/os-templates/sync`
- Service functions/files: `lib/os-template-availability.ts`, `lib/os-template-normalization.ts`
- DB models: `OsTemplate`, `ProxmoxNode`

## IP Pools

- Browser URL: `/admin/ip-pools, /admin/ip-pools/[id]`
- Page component: `app/admin/ip-pools/page.tsx, app/admin/ip-pools/[id]/page.tsx`
- Sidebar entry: Infrastructure > IP Pools
- API calls: `/api/admin/ip-pools`, `/api/admin/ip-pools/[id]`, `/api/admin/ip-pools/[id]/allocations`
- Service functions/files: `lib/ip-pool.ts`, `lib/ipam-admin.ts`, `lib/vm-network-orchestrator.ts`
- DB models: `IpPool`, `IpPoolRange`, `IpAllocation`, `VmIpAssignment`, `VmNetworkInterface`, `VmNetworkEvent`

## Backups

- Browser URL: `/admin/backups`
- Page component: `app/admin/backups/page.tsx`
- Sidebar entry: System > Backups
- API calls: `/api/admin/backups`, `/api/admin/backups/upload`, `/api/admin/backups/[id]/restore`, `/api/admin/backups/[id]/restore-test`
- Service functions/files: `lib/backups.ts`, `lib/backup-health.ts`, `lib/google-drive-backup.ts`
- DB models: `BackupRun`, `BackupDestination`, `BackupRestoreTest`, `RuntimeIntegration`

## Notifications

- Browser URL: `/admin/notifications, /admin/notifications/logs`
- Page component: `app/admin/notifications/page.tsx, app/admin/notifications/logs/page.tsx`
- Sidebar entry: Communication > Notifications
- API calls: `/api/admin/notifications/settings`, `/api/admin/notifications/logs`
- Service functions/files: `lib/notifications/service.ts`, `lib/email/send.ts`, `lib/whatsapp/send.ts`
- DB models: `NotificationDeliveryLog`, `EmailLog`, `WhatsAppMessageLog`, `CustomerNotificationPreference`

## WhatsApp

- Browser URL: `/admin/whatsapp`
- Page component: `app/admin/whatsapp/page.tsx`
- Sidebar entry: Communication > WhatsApp
- API calls: `/api/admin/whatsapp/status`, `/api/admin/whatsapp/health`, `/api/admin/whatsapp/send`, `/api/admin/whatsapp/test-message`
- Service functions/files: `lib/whatsapp/evolution.ts`, `lib/whatsapp/send.ts`, `lib/whatsapp/queue.ts`
- DB models: `RuntimeIntegration`, `WhatsAppMessageLog`, `WhatsAppCampaign`, `WhatsAppCampaignLog`
