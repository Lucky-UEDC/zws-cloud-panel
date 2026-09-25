
[+] Added tables
  - admin_profiles
  - customers
  - products
  - dedicated_inquiries
  - catalog_categories
  - custom_configs
  - orders
  - invoices
  - payments
  - analytics_events
  - admin_settings
  - wallet_transactions
  - support_tickets
  - support_ticket_messages
  - password_reset_tokens
  - auth_challenges
  - plan_sync_runs
  - settings
  - audit_logs
  - os_templates
  - proxmox_nodes

[*] Changed the `audit_logs` table
  [+] Added foreign key on columns (customerId)
  [+] Added foreign key on columns (adminId)

[*] Changed the `catalog_categories` table
  [+] Added foreign key on columns (parentId)

[*] Changed the `custom_configs` table
  [+] Added foreign key on columns (customerId)

[*] Changed the `dedicated_inquiries` table
  [+] Added foreign key on columns (productId)
  [+] Added foreign key on columns (customerId)

[*] Changed the `invoices` table
  [+] Added foreign key on columns (orderId)
  [+] Added foreign key on columns (customerId)

[*] Changed the `orders` table
  [+] Added foreign key on columns (customerId)
  [+] Added foreign key on columns (productId)
  [+] Added foreign key on columns (customConfigId)

[*] Changed the `password_reset_tokens` table
  [+] Added foreign key on columns (customerId)

[*] Changed the `payments` table
  [+] Added foreign key on columns (orderId)
  [+] Added foreign key on columns (invoiceId)
  [+] Added foreign key on columns (customerId)

[*] Changed the `products` table
  [+] Added foreign key on columns (categoryId)
  [+] Added foreign key on columns (subcategoryId)

[*] Changed the `support_ticket_messages` table
  [+] Added foreign key on columns (ticketId)
  [+] Added foreign key on columns (customerId)
  [+] Added foreign key on columns (adminId)

[*] Changed the `support_tickets` table
  [+] Added foreign key on columns (customerId)
  [+] Added foreign key on columns (createdByAdminId)
  [+] Added foreign key on columns (assignedAdminId)

[*] Changed the `wallet_transactions` table
  [+] Added foreign key on columns (customerId)
  [+] Added foreign key on columns (paymentId)
  [+] Added foreign key on columns (createdByAdminId)

