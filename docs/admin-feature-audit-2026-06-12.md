# MYRDPHUB Admin Feature Audit - 2026-06-12

This audit compares admin capabilities across database models, backend APIs, sidebar exposure, page routes, and recovery status.

| Feature | DB / Storage | API | UI Route | Sidebar | Status |
| --- | --- | --- | --- | --- | --- |
| Dashboard | Order, Invoice, Payment, VpsInstance, Customer | `/api/admin/dashboard`, `/api/admin/revenue` | `/admin` | Dashboard | Connected |
| Customers | Customer, Order, Invoice, WalletTransaction | `/api/admin/customers` | `/admin/customers` | Customers > Customers | Connected |
| Orders | Order, ProvisioningJob, VpsInstance | `/api/admin/orders`, `/api/admin/orders/with-vm-status` | `/admin/orders` | Customers > Orders | Connected |
| Invoices | Invoice, Payment | `/api/admin/invoices` | `/admin/invoices` | Payments > Invoices | Connected |
| Nodes | ProxmoxNode, NodeLimit, NodeMetric | `/api/admin/compute-nodes` | `/admin/compute-nodes` | Infrastructure > Nodes | Connected |
| Templates | OsTemplate | `/api/admin/os-templates` | `/admin/os-templates` | Infrastructure > Templates | Connected; OS compatibility gates removed |
| Virtual Machines | VpsInstance, VmNetwork*, ProvisioningJob | `/api/admin/vms`, `/api/admin/vms/[id]`, `/api/admin/vms/[id]/actions` | `/admin/vms` | Infrastructure > Virtual Machines | Restored as compact table + drawer |
| Networking / IP Pools | IpPool, IpPoolRange, IpAllocation | `/api/admin/ip-pools` | `/admin/ip-pools` | Infrastructure > Networking | Connected |
| WhatsApp Overview | WhatsAppMessageLog, WhatsAppCampaign, WhatsAppContact, WhatsAppConversation | `/api/admin/whatsapp/overview` | `/admin/whatsapp` | Communication > WhatsApp > Overview | Restored |
| WhatsApp Templates | WhatsAppTemplate, WhatsAppTemplateVersion, WhatsAppTemplateVariable | `/api/admin/whatsapp/templates` | `/admin/whatsapp/templates` | Communication > WhatsApp > Templates | Restored |
| WhatsApp Contacts | Customer, WhatsAppContact | `/api/admin/whatsapp/contacts` | `/admin/whatsapp/contacts` | Communication > WhatsApp > Contacts | Added |
| WhatsApp Conversations | WhatsAppConversation, WhatsAppConversationMessage | `/api/admin/whatsapp/conversations` | `/admin/whatsapp/conversations` | Communication > WhatsApp > Conversations | Added |
| WhatsApp Campaigns | WhatsAppCampaign, WhatsAppCampaignRecipient, WhatsAppCampaignMedia | `/api/admin/whatsapp/campaigns` | `/admin/whatsapp/campaigns` | Communication > WhatsApp > Campaigns | Restored; audience filters expanded |
| WhatsApp Auto Replies | WhatsAppAutoReplyRule, WhatsAppConversationMessage | `/api/admin/whatsapp/auto-replies` | `/admin/whatsapp/auto-replies` | Communication > WhatsApp > Auto Replies | Added |
| WhatsApp Message Logs | WhatsAppMessageLog, WhatsAppConversationMessage, WhatsAppErrorLog | `/api/admin/whatsapp/logs` | `/admin/whatsapp/logs` | Communication > WhatsApp > Message Logs | Restored |
| WhatsApp Webhook Logs | WhatsAppWebhookEvent | `/api/admin/whatsapp/webhook-logs`, `/api/webhooks/evolution` | `/admin/whatsapp/webhook-logs` | Communication > WhatsApp > Webhook Logs | Added |
| WhatsApp Settings | RuntimeIntegration | `/api/admin/whatsapp/settings`, `/api/admin/whatsapp/status` | `/admin/whatsapp/settings` | Communication > WhatsApp > Settings | Moved from root |
| Email | EmailTemplate, EmailLog, SMTP settings | `/api/admin/email/*` | `/admin/email` | Communication > Email | Connected |
| Notifications | AdminSetting, NotificationRule, WhatsAppMessageLog | `/api/admin/notifications/settings`, `/api/admin/notifications/logs` | `/admin/notifications` | Communication > Notifications | Merged settings + logs |
| Integrations | RuntimeIntegration | `/api/admin/integrations/*` | `/admin/integrations` | Communication > Integrations | Moved out of System |
| Interactions | Audit / interaction telemetry | `/api/admin/system/interactions` | `/admin/system/interactions` | Communication > Interactions | Moved out of System |
| Diagnostics | Proxmox / session diagnostics | `/api/admin/diagnostics` | `/admin/diagnostics` | Monitoring > Diagnostics | Moved out of System |
| Frontend Health | Frontend diagnostics collector | `/api/admin/system/frontend-health` | `/admin/system/frontend-health` | Monitoring > Frontend Health | Moved out of System |
| Settings | SystemSetting, AdminSetting | `/api/admin/settings/*` | `/admin/settings` | System > Settings | Connected |
| Security | CloudflareSecuritySettings, sessions, MFA | `/api/admin/security/*` | `/admin/security` | System > Security | Connected |
| Backups | BackupRun, BackupDestination | `/api/admin/backups` | `/admin/backups` | System > Backups | Connected |
| Audit Logs | AuditLog, AuditEvent | `/api/admin/logs`, `/api/admin/audit` | `/admin/logs` | System > Audit Logs | Connected |

## Missing Features Found

- WhatsApp root page only exposed Evolution settings; CRM sections existed partly as hidden subroutes or had no page.
- Contacts, conversations, auto replies, and webhook logs had no complete UI/API/storage path.
- Notification logs were split into a separate route and menu item.
- Old Windows/Linux capacity labels and schema fields remained even after routing was neutralized.
- VM list exposed lifecycle, diagnostics, and action sprawl directly in the table.

## Recovery Status

- WhatsApp CRM routes, storage, and webhook ingestion have been added.
- Sidebar now exposes the requested hierarchy and removes OTP Health / Notification Logs from navigation.
- System menu is limited to Settings, Security, Backups, and Audit Logs.
- VM details deep links redirect to `/admin/vms?vm=<id>` so the drawer is the primary detail surface.
- Node OS compatibility tables and `windows_only` / `linux_only` settings columns are removed by migration.

## Live Verification

- Active release verified: `/var/www/myrdphub/releases/20260612-123934-admin-recovery`.
- PM2 apps verified online from `/var/www/myrdphub`: `zws-web`, `zws-whatsapp`, `zws-worker`.
- Playwright live audit passed against `http://127.0.0.1:3000` with `PLAYWRIGHT_SKIP_WEBSERVER=1`.
- Visible admin route crawl visited 36 sidebar routes; all returned HTTP 200.
- Removed menu items confirmed absent from navigation: OTP Health, Notification Logs, Windows Nodes, Linux Nodes, Windows/Linux capacity labels.
- Screenshots captured in `test-artifacts/admin-recovery-live-2026-06-12/`: dashboard, communication menu, system menu, WhatsApp Overview/Templates/Contacts/Conversations/Campaigns/Auto Replies/Message Logs/Webhook Logs/Settings, Notifications, and VMs drawer.
- Static/build checks passed: Prisma validate/generate, typecheck, lint, full unit suite, migration deploy/validation, production build, frontend verification, chunk smoke, and route audit.

## VM Drawer And IP Inventory Follow-Up - 2026-06-12

- Active release verified: `/var/www/myrdphub/releases/20260612-144700-vm-drawer-ip-reinstall-modal`.
- VM drawer now keeps common actions in the sticky header/action bar: Console, Start, Stop, Restart, Change IP, Reinstall, Extend Service, Billing, and Delete.
- Drawer URL behavior verified live for direct `/admin/vms?vm=<id>`, X close, ESC close, outside click close, and browser Back returning to `/admin/vms` without a full page reload.
- IP inventory joins now merge `VmIpAssignment`, `IpAllocation`, `VpsInstance`, `ProxmoxNode`, `IpPool.proxmoxNode`, `Order`, and `Customer` so related VMID, hostname, node, customer, assigned date, and last changed fields do not fall back to `-` when data exists.
- Live target VM: `cmq9qhd7p01xhpjwlle18r3zi`, VMID `139`, hostname `zws.zp2-medium.sonukhan1-1`, customer `Sonukhan1`, node `pve`.
- Live Change IP result: `162.141.0.66` to `162.141.0.67`; inventory row populated node `pve`, node ID `cmpve32i400xbpjpe4u9xui0n`, assigned date `2026-06-12T14:48:41.891Z`, and last changed `2026-06-12T14:48:41.892Z`.
- Live Playwright passed against PM2-served `http://127.0.0.1:3000` with real Start, Stop, Start, Restart, Change IP, and reinstall queue validation.
- VM drawer/IP screenshots and JSON artifacts captured in `test-artifacts/vm-drawer-ip-fix-2026-06-12/`.
