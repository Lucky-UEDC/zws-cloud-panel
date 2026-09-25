# MYRDPHUB DB Integrity Audit - 2026-07-12

Mode: apply
Backup: /var/www/myrdphub/backups/zws-db-integrity-2026-07-12T00-00-55-191Z.dump

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
| ipam | Active VPS IPs without an active allocation | critical | 0 | Assign an existing free allocation row when the IP match is unique. |
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
| wallets | Wallet transactions linked to missing customers | critical | 0 |  |
| ssh_keys | SSH keys linked to missing customers | critical | 0 |  |
| backups | Backup runs linked to missing destinations | warning | 0 |  |
| snapshots | VM snapshots linked to missing VPS | warning | 0 |  |
| backups | VM backups linked to missing VPS | warning | 0 |  |
| schema | Orphaned accounting_entries rows referencing accounting_accounts | critical | 0 |  |
| schema | Orphaned accounting_entries rows referencing accounting_journals | critical | 0 |  |
| schema | Orphaned admin_customer_impersonation_tokens rows referencing admin_profiles | critical | 0 |  |
| schema | Orphaned admin_customer_impersonation_tokens rows referencing customers | critical | 0 |  |
| schema | Orphaned admin_profiles rows referencing roles | critical | 0 |  |
| schema | Orphaned audit_logs rows referencing admin_profiles | critical | 0 |  |
| schema | Orphaned audit_logs rows referencing customers | critical | 0 |  |
| schema | Orphaned backup_restore_tests rows referencing backup_runs | critical | 0 |  |
| schema | Orphaned backup_runs rows referencing backup_destinations | critical | 0 |  |
| schema | Orphaned bandwidth_throttle_states rows referencing vps_instances | critical | 0 |  |
| schema | Orphaned bandwidth_usage_alerts rows referencing vps_instances | critical | 0 |  |
| schema | Orphaned bandwidth_usage_rollups rows referencing vps_instances | critical | 0 |  |
| schema | Orphaned bandwidth_usage_samples rows referencing vps_instances | critical | 0 |  |
| schema | Orphaned blog_post_tags rows referencing blog_posts | critical | 0 |  |
| schema | Orphaned blog_post_tags rows referencing cms_tags | critical | 0 |  |
| schema | Orphaned blog_posts rows referencing cms_categories | critical | 0 |  |
| schema | Orphaned blog_posts rows referencing cms_media_assets | critical | 0 |  |
| schema | Orphaned blog_posts rows referencing cms_media_assets | critical | 0 |  |
| schema | Orphaned catalog_categories rows referencing catalog_categories | critical | 0 |  |
| schema | Orphaned checkout_intents rows referencing customers | critical | 0 |  |
| schema | Orphaned checkout_sessions rows referencing customers | critical | 0 |  |
| schema | Orphaned coupon_redemptions rows referencing coupons | critical | 0 |  |
| schema | Orphaned coupon_redemptions rows referencing customers | critical | 0 |  |
| schema | Orphaned coupon_redemptions rows referencing orders | critical | 0 |  |
| schema | Orphaned coupon_redemptions rows referencing payments | critical | 0 |  |
| schema | Orphaned custom_configs rows referencing customers | critical | 0 |  |
| schema | Orphaned customer_import_rows rows referencing customer_import_jobs | critical | 0 |  |
| schema | Orphaned customer_notification_preferences rows referencing customers | critical | 0 |  |
| schema | Orphaned dedicated_inquiries rows referencing customers | critical | 0 |  |
| schema | Orphaned dedicated_inquiries rows referencing products | critical | 0 |  |
| schema | Orphaned dedicated_services rows referencing customers | critical | 0 |  |
| schema | Orphaned dedicated_services rows referencing dedicated_os_options | critical | 0 |  |
| schema | Orphaned dedicated_services rows referencing orders | critical | 0 |  |
| schema | Orphaned dedicated_services rows referencing products | critical | 0 |  |
| schema | Orphaned domain_gateway_configs rows referencing domain_configs | critical | 0 |  |
| schema | Orphaned duplicate_vm_incidents rows referencing proxmox_nodes | critical | 0 |  |
| schema | Orphaned duplicate_vm_incidents rows referencing vps_instances | critical | 0 |  |
| schema | Orphaned email_verification_tokens rows referencing customers | critical | 0 |  |
| schema | Orphaned invoices rows referencing customers | critical | 0 |  |
| schema | Orphaned invoices rows referencing orders | critical | 0 |  |
| schema | Orphaned ip_allocations rows referencing proxmox_nodes | critical | 0 |  |
| schema | Orphaned ip_allocations rows referencing ip_pools | critical | 0 |  |
| schema | Orphaned ip_allocations rows referencing vps_instances | critical | 0 |  |
| schema | Orphaned ip_pool_ranges rows referencing ip_pools | critical | 0 |  |
| schema | Orphaned ip_pools rows referencing proxmox_nodes | critical | 0 |  |
| schema | Orphaned node_ip_pools rows referencing proxmox_nodes | critical | 0 |  |
| schema | Orphaned node_ip_pools rows referencing ip_pools | critical | 0 |  |
| schema | Orphaned node_limits rows referencing proxmox_nodes | critical | 0 |  |
| schema | Orphaned node_metric_hourly rows referencing proxmox_nodes | critical | 0 |  |
| schema | Orphaned node_metrics rows referencing proxmox_nodes | critical | 0 |  |
| schema | Orphaned node_storage_pool_configs rows referencing proxmox_nodes | critical | 0 |  |
| schema | Orphaned node_workers rows referencing proxmox_nodes | critical | 0 |  |
| schema | Orphaned offers rows referencing node_classes | critical | 0 |  |
| schema | Orphaned offers rows referencing os_templates | critical | 0 |  |
| schema | Orphaned offers rows referencing products | critical | 0 |  |
| schema | Orphaned offers rows referencing node_storage_pool_configs | critical | 0 |  |
| schema | Orphaned orders rows referencing coupons | critical | 0 |  |
| schema | Orphaned orders rows referencing custom_configs | critical | 0 |  |
| schema | Orphaned orders rows referencing customers | critical | 0 |  |
| schema | Orphaned orders rows referencing node_classes | critical | 0 |  |
| schema | Orphaned orders rows referencing offers | critical | 0 |  |
| schema | Orphaned orders rows referencing os_templates | critical | 0 |  |
| schema | Orphaned orders rows referencing products | critical | 0 |  |
| schema | Orphaned orders rows referencing proxmox_nodes | critical | 0 |  |
| schema | Orphaned orders rows referencing ssh_keys | critical | 0 |  |
| schema | Orphaned orders rows referencing node_storage_pool_configs | critical | 0 |  |
| schema | Orphaned os_templates rows referencing proxmox_nodes | critical | 0 |  |
| schema | Orphaned password_reset_tokens rows referencing customers | critical | 0 |  |
| schema | Orphaned payment_attempts rows referencing domain_configs | critical | 0 |  |
| schema | Orphaned payment_attempts rows referencing domain_gateway_configs | critical | 0 |  |
| schema | Orphaned payment_attempts rows referencing invoices | critical | 0 |  |
| schema | Orphaned payment_attempts rows referencing orders | critical | 0 |  |
| schema | Orphaned payment_attempts rows referencing payments | critical | 0 |  |
| schema | Orphaned payment_bridge_tokens rows referencing payment_attempts | critical | 0 |  |
| schema | Orphaned payment_diagnostic_checks rows referencing payment_diagnostic_runs | critical | 0 |  |
| schema | Orphaned payment_gateway_attempts rows referencing invoices | critical | 0 |  |
| schema | Orphaned payment_gateway_attempts rows referencing orders | critical | 0 |  |
| schema | Orphaned payment_gateway_attempts rows referencing payments | critical | 0 |  |
| schema | Orphaned payment_webhook_events rows referencing payments | critical | 0 |  |
| schema | Orphaned payments rows referencing checkout_intents | critical | 0 |  |
| schema | Orphaned payments rows referencing checkout_sessions | critical | 0 |  |
| schema | Orphaned payments rows referencing customers | critical | 0 |  |
| schema | Orphaned payments rows referencing invoices | critical | 0 |  |
| schema | Orphaned payments rows referencing orders | critical | 0 |  |
| schema | Orphaned pool_node_assignments rows referencing proxmox_nodes | critical | 0 |  |
| schema | Orphaned pool_node_assignments rows referencing ip_pools | critical | 0 |  |
| schema | Orphaned pool_product_assignments rows referencing ip_pools | critical | 0 |  |
| schema | Orphaned pool_product_assignments rows referencing products | critical | 0 |  |
| schema | Orphaned product_ip_pools rows referencing ip_pools | critical | 0 |  |
| schema | Orphaned product_ip_pools rows referencing products | critical | 0 |  |
| schema | Orphaned products rows referencing catalog_categories | critical | 0 |  |
| schema | Orphaned products rows referencing proxmox_nodes | critical | 0 |  |
| schema | Orphaned products rows referencing node_classes | critical | 0 |  |
| schema | Orphaned products rows referencing catalog_categories | critical | 0 |  |
| schema | Orphaned provisioning_jobs rows referencing customers | critical | 0 |  |
| schema | Orphaned provisioning_jobs rows referencing orders | critical | 0 |  |
| schema | Orphaned provisioning_jobs rows referencing vps_instances | critical | 0 |  |
| schema | Orphaned provisioning_task_logs rows referencing provisioning_jobs | critical | 0 |  |
| schema | Orphaned provisioning_task_steps rows referencing provisioning_jobs | critical | 0 |  |
| schema | Orphaned proxmox_nodes rows referencing node_classes | critical | 0 |  |
| schema | Orphaned role_permissions rows referencing permissions | critical | 0 |  |
| schema | Orphaned role_permissions rows referencing roles | critical | 0 |  |
| schema | Orphaned ssh_keys rows referencing customers | critical | 0 |  |
| schema | Orphaned support_ticket_attachments rows referencing admin_profiles | critical | 0 |  |
| schema | Orphaned support_ticket_attachments rows referencing customers | critical | 0 |  |
| schema | Orphaned support_ticket_attachments rows referencing support_ticket_messages | critical | 0 |  |
| schema | Orphaned support_ticket_attachments rows referencing support_tickets | critical | 0 |  |
| schema | Orphaned support_ticket_messages rows referencing admin_profiles | critical | 0 |  |
| schema | Orphaned support_ticket_messages rows referencing customers | critical | 0 |  |
| schema | Orphaned support_ticket_messages rows referencing support_tickets | critical | 0 |  |
| schema | Orphaned support_tickets rows referencing admin_profiles | critical | 0 |  |
| schema | Orphaned support_tickets rows referencing admin_profiles | critical | 0 |  |
| schema | Orphaned support_tickets rows referencing customers | critical | 0 |  |
| schema | Orphaned tenant_database_mappings rows referencing database_registry | critical | 0 |  |
| schema | Orphaned vm_action_jobs rows referencing customers | critical | 0 |  |
| schema | Orphaned vm_action_jobs rows referencing proxmox_nodes | critical | 0 |  |
| schema | Orphaned vm_action_jobs rows referencing vps_instances | critical | 0 |  |
| schema | Orphaned vm_ip_assignments rows referencing vm_network_interfaces | critical | 0 |  |
| schema | Orphaned vm_ip_assignments rows referencing ip_pools | critical | 0 |  |
| schema | Orphaned vm_ip_assignments rows referencing proxmox_nodes | critical | 0 |  |
| schema | Orphaned vm_ip_assignments rows referencing vps_instances | critical | 0 |  |
| schema | Orphaned vm_network_events rows referencing proxmox_nodes | critical | 0 |  |
| schema | Orphaned vm_network_events rows referencing vps_instances | critical | 0 |  |
| schema | Orphaned vm_network_interfaces rows referencing proxmox_nodes | critical | 0 |  |
| schema | Orphaned vm_network_interfaces rows referencing vps_instances | critical | 0 |  |
| schema | Orphaned vm_provisioning_identities rows referencing orders | critical | 0 |  |
| schema | Orphaned vm_provisioning_identities rows referencing proxmox_nodes | critical | 0 |  |
| schema | Orphaned vm_provisioning_identities rows referencing vps_instances | critical | 0 |  |
| schema | Orphaned vps_disks rows referencing node_storage_pool_configs | critical | 0 |  |
| schema | Orphaned vps_disks rows referencing vps_instances | critical | 0 |  |
| schema | Orphaned vps_instances rows referencing customers | critical | 0 |  |
| schema | Orphaned vps_instances rows referencing node_classes | critical | 0 |  |
| schema | Orphaned vps_instances rows referencing os_templates | critical | 0 |  |
| schema | Orphaned vps_instances rows referencing orders | critical | 0 |  |
| schema | Orphaned vps_instances rows referencing products | critical | 0 |  |
| schema | Orphaned vps_instances rows referencing proxmox_nodes | critical | 0 |  |
| schema | Orphaned vps_instances rows referencing node_storage_pool_configs | critical | 0 |  |
| schema | Orphaned vps_upgrade_requests rows referencing customers | critical | 0 |  |
| schema | Orphaned vps_upgrade_requests rows referencing vps_instances | critical | 0 |  |
| schema | Orphaned wallet_transactions rows referencing admin_profiles | critical | 0 |  |
| schema | Orphaned wallet_transactions rows referencing customers | critical | 0 |  |
| schema | Orphaned wallet_transactions rows referencing payment_attempts | critical | 0 |  |
| schema | Orphaned wallet_transactions rows referencing payments | critical | 0 |  |
| schema | Orphaned whatsapp_campaign_logs rows referencing whatsapp_campaigns | critical | 0 |  |
| schema | Orphaned whatsapp_conversation_messages rows referencing whatsapp_conversations | critical | 0 |  |
| schema | Orphaned whatsapp_template_translations rows referencing whatsapp_templates | critical | 0 |  |
| schema | Orphaned whatsapp_template_versions rows referencing whatsapp_templates | critical | 0 |  |

## Remaining Manual Blockers

- None detected by critical checks.

Repairs are intentionally limited to idempotent visibility, revenue exclusion, and IP-release fixes where the target state is unambiguous.
