CREATE TABLE IF NOT EXISTS "dedicated_os_options" (
  "id" TEXT NOT NULL,
  "family" TEXT NOT NULL,
  "familyLabel" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "version" TEXT,
  "slug" TEXT NOT NULL,
  "iconUrl" TEXT,
  "description" TEXT,
  "defaultUsername" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "isRecommended" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dedicated_os_options_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "dedicated_services" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "productId" TEXT,
  "dedicatedOsOptionId" TEXT,
  "serviceNumber" TEXT NOT NULL,
  "hostname" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending_payment',
  "selectedOsFamily" TEXT,
  "selectedOsName" TEXT,
  "installationNotes" TEXT,
  "sshPublicKey" TEXT,
  "ipmiRequired" BOOLEAN NOT NULL DEFAULT false,
  "deliverySlaHours" INTEGER NOT NULL DEFAULT 72,
  "paymentConfirmedAt" TIMESTAMP(3),
  "estimatedDeliveryAt" TIMESTAMP(3),
  "installingAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "refundedAt" TIMESTAMP(3),
  "nextRenewalAt" TIMESTAMP(3),
  "renewalAmount" DECIMAL(10,2),
  "primaryIp" TEXT,
  "username" TEXT,
  "passwordEncrypted" TEXT,
  "panelUrl" TEXT,
  "installedOs" TEXT,
  "deliveryNotes" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dedicated_services_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "dedicated_os_options_slug_key" ON "dedicated_os_options"("slug");
CREATE INDEX IF NOT EXISTS "dedicated_os_options_family_isActive_sortOrder_idx" ON "dedicated_os_options"("family", "isActive", "sortOrder");
CREATE INDEX IF NOT EXISTS "dedicated_os_options_isActive_sortOrder_idx" ON "dedicated_os_options"("isActive", "sortOrder");

CREATE UNIQUE INDEX IF NOT EXISTS "dedicated_services_orderId_key" ON "dedicated_services"("orderId");
CREATE UNIQUE INDEX IF NOT EXISTS "dedicated_services_serviceNumber_key" ON "dedicated_services"("serviceNumber");
CREATE INDEX IF NOT EXISTS "dedicated_services_customerId_status_idx" ON "dedicated_services"("customerId", "status");
CREATE INDEX IF NOT EXISTS "dedicated_services_productId_idx" ON "dedicated_services"("productId");
CREATE INDEX IF NOT EXISTS "dedicated_services_dedicatedOsOptionId_idx" ON "dedicated_services"("dedicatedOsOptionId");
CREATE INDEX IF NOT EXISTS "dedicated_services_status_createdAt_idx" ON "dedicated_services"("status", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dedicated_services_customerId_fkey'
  ) THEN
    ALTER TABLE "dedicated_services" ADD CONSTRAINT "dedicated_services_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dedicated_services_orderId_fkey'
  ) THEN
    ALTER TABLE "dedicated_services" ADD CONSTRAINT "dedicated_services_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dedicated_services_productId_fkey'
  ) THEN
    ALTER TABLE "dedicated_services" ADD CONSTRAINT "dedicated_services_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dedicated_services_dedicatedOsOptionId_fkey'
  ) THEN
    ALTER TABLE "dedicated_services" ADD CONSTRAINT "dedicated_services_dedicatedOsOptionId_fkey" FOREIGN KEY ("dedicatedOsOptionId") REFERENCES "dedicated_os_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "dedicated_os_options" ("id", "family", "familyLabel", "name", "version", "slug", "iconUrl", "description", "defaultUsername", "isActive", "isRecommended", "sortOrder", "metadata")
VALUES
  ('dedos_proxmox_91', 'proxmox', 'Proxmox VE', 'Proxmox VE 9.1', '9.1', 'proxmox-ve-9-1', '/os-icons/linux.svg', 'Bare-metal virtualization platform', 'root', true, true, 10, '{}'),
  ('dedos_proxmox_84', 'proxmox', 'Proxmox VE', 'Proxmox VE 8.4', '8.4', 'proxmox-ve-8-4', '/os-icons/linux.svg', 'Bare-metal virtualization platform', 'root', true, false, 20, '{}'),
  ('dedos_virtualizor_latest', 'virtualizor', 'Virtualizor', 'Latest stable', 'latest', 'virtualizor-latest-stable', '/os-icons/linux.svg', 'Virtualizor latest stable installation', 'root', true, false, 30, '{}'),
  ('dedos_vmware_esxi_8', 'vmware', 'VMware', 'VMware ESXi 8', '8', 'vmware-esxi-8', '/os-icons/linux.svg', 'VMware ESXi hypervisor', 'root', true, false, 40, '{}'),
  ('dedos_vmware_esxi_7', 'vmware', 'VMware', 'VMware ESXi 7', '7', 'vmware-esxi-7', '/os-icons/linux.svg', 'VMware ESXi hypervisor', 'root', true, false, 50, '{}'),
  ('dedos_ubuntu_2404', 'ubuntu', 'Ubuntu', 'Ubuntu 24.04', '24.04', 'ubuntu-24-04', '/os-icons/ubuntu.svg', 'Ubuntu LTS server', 'root', true, true, 60, '{}'),
  ('dedos_ubuntu_2204', 'ubuntu', 'Ubuntu', 'Ubuntu 22.04', '22.04', 'ubuntu-22-04', '/os-icons/ubuntu.svg', 'Ubuntu LTS server', 'root', true, false, 70, '{}'),
  ('dedos_debian_12', 'debian', 'Debian', 'Debian 12', '12', 'debian-12', '/os-icons/debian.svg', 'Debian stable server', 'root', true, false, 80, '{}'),
  ('dedos_almalinux_10', 'almalinux', 'AlmaLinux', 'AlmaLinux 10', '10', 'almalinux-10', '/os-icons/almalinux.svg', 'Enterprise Linux compatible server', 'root', true, false, 90, '{}'),
  ('dedos_almalinux_9', 'almalinux', 'AlmaLinux', 'AlmaLinux 9', '9', 'almalinux-9', '/os-icons/almalinux.svg', 'Enterprise Linux compatible server', 'root', true, false, 100, '{}'),
  ('dedos_rocky_9', 'rocky', 'Rocky Linux', 'Rocky Linux 9', '9', 'rocky-linux-9', '/os-icons/rocky.svg', 'Enterprise Linux compatible server', 'root', true, false, 110, '{}'),
  ('dedos_centos_stream_9', 'centos', 'CentOS', 'CentOS Stream 9', '9', 'centos-stream-9', '/os-icons/centos.svg', 'CentOS Stream server', 'root', true, false, 120, '{}'),
  ('dedos_windows_2022', 'windows', 'Windows Server', 'Windows Server 2022', '2022', 'windows-server-2022', '/os-icons/linux.svg', 'Windows Server installation', 'Administrator', true, false, 130, '{}'),
  ('dedos_windows_2019', 'windows', 'Windows Server', 'Windows Server 2019', '2019', 'windows-server-2019', '/os-icons/linux.svg', 'Windows Server installation', 'Administrator', true, false, 140, '{}'),
  ('dedos_custom_os', 'other', 'Other', 'Custom OS / open support ticket', 'custom', 'custom-os-open-support-ticket', '/os-icons/linux.svg', 'Custom OS request coordinated by support', NULL, true, false, 150, '{"customRequest": true}')
ON CONFLICT ("slug") DO UPDATE SET
  "family" = EXCLUDED."family",
  "familyLabel" = EXCLUDED."familyLabel",
  "name" = EXCLUDED."name",
  "version" = EXCLUDED."version",
  "iconUrl" = EXCLUDED."iconUrl",
  "description" = EXCLUDED."description",
  "defaultUsername" = EXCLUDED."defaultUsername",
  "isActive" = EXCLUDED."isActive",
  "isRecommended" = EXCLUDED."isRecommended",
  "sortOrder" = EXCLUDED."sortOrder",
  "metadata" = EXCLUDED."metadata";

INSERT INTO "email_templates" ("id", "key", "group", "category", "name", "subject", "preheader", "htmlBody", "textBody", "enabled", "updatedBy")
VALUES
  (concat('email_template_', 'dedicated_order_created'), 'dedicated_order_created', 'Dedicated', 'service', 'Dedicated order created', 'Dedicated server order {{orderId}} created', 'We received your dedicated server order.', '<h1>Dedicated server order created</h1><p>Hi {{userName}},</p><p>Order {{orderId}} for {{productName}} has been created.</p><p>Amount: {{currency}} {{amount}}.</p><p><a href="{{paymentUrl}}">Pay invoice</a></p><p>{{brandName}}</p>', 'Dedicated server order created\n\nHi {{userName}},\n\nOrder {{orderId}} for {{productName}} has been created.\n\nAmount: {{currency}} {{amount}}.\n\nPay invoice: {{paymentUrl}}\n\n{{brandName}}', true, 'migration'),
  (concat('email_template_', 'dedicated_payment_confirmed'), 'dedicated_payment_confirmed', 'Dedicated', 'service', 'Dedicated payment confirmed', 'Payment confirmed for dedicated server {{orderId}}', 'Your dedicated server is being prepared.', '<h1>Payment confirmed</h1><p>Hi {{userName}},</p><p>Payment for {{productName}} is confirmed. ZWS Cloud engineers are preparing your dedicated server.</p><p>Estimated delivery: within {{deliverySlaHours}} hours.</p><p><a href="{{serviceUrl}}">Track delivery</a></p><p>{{brandName}}</p>', 'Payment confirmed\n\nHi {{userName}},\n\nPayment for {{productName}} is confirmed. ZWS Cloud engineers are preparing your dedicated server.\n\nEstimated delivery: within {{deliverySlaHours}} hours.\n\nTrack delivery: {{serviceUrl}}\n\n{{brandName}}', true, 'migration'),
  (concat('email_template_', 'dedicated_installing'), 'dedicated_installing', 'Dedicated', 'service', 'Dedicated installing', 'Dedicated server installation started', 'Installation is in progress.', '<h1>Installation started</h1><p>Hi {{userName}},</p><p>ZWS Cloud engineers have started installing {{productName}}.</p><p><a href="{{serviceUrl}}">View status</a></p><p>{{brandName}}</p>', 'Installation started\n\nHi {{userName}},\n\nZWS Cloud engineers have started installing {{productName}}.\n\nView status: {{serviceUrl}}\n\n{{brandName}}', true, 'migration'),
  (concat('email_template_', 'dedicated_delivered'), 'dedicated_delivered', 'Dedicated', 'service', 'Dedicated delivered', 'Your dedicated server is delivered', 'Your dedicated server credentials are ready.', '<h1>Dedicated server delivered</h1><p>Hi {{userName}},</p><p>Your dedicated server {{serviceName}} is ready.</p><p><strong>IP:</strong> {{primaryIp}}<br><strong>Username:</strong> {{serverUsername}}<br><strong>Temporary password:</strong> {{temporaryPassword}}<br><strong>Panel/IPMI:</strong> {{panelUrl}}</p><p>For security, change the temporary password after first login.</p><p><a href="{{serviceUrl}}">Open service</a></p><p>{{brandName}}</p>', 'Dedicated server delivered\n\nHi {{userName}},\n\nYour dedicated server {{serviceName}} is ready.\n\nIP: {{primaryIp}}\nUsername: {{serverUsername}}\nTemporary password: {{temporaryPassword}}\nPanel/IPMI: {{panelUrl}}\n\nFor security, change the temporary password after first login.\n\nOpen service: {{serviceUrl}}\n\n{{brandName}}', true, 'migration'),
  (concat('email_template_', 'dedicated_cancelled'), 'dedicated_cancelled', 'Dedicated', 'service', 'Dedicated cancelled', 'Dedicated server order {{orderId}} cancelled', 'Your dedicated server order was cancelled.', '<h1>Dedicated server order cancelled</h1><p>Hi {{userName}},</p><p>Order {{orderId}} has been cancelled.</p><p>{{brandName}}</p>', 'Dedicated server order cancelled\n\nHi {{userName}},\n\nOrder {{orderId}} has been cancelled.\n\n{{brandName}}', true, 'migration'),
  (concat('email_template_', 'dedicated_refunded'), 'dedicated_refunded', 'Dedicated', 'service', 'Dedicated refunded', 'Dedicated server order {{orderId}} refunded', 'Your dedicated server order was marked refunded.', '<h1>Dedicated server order refunded</h1><p>Hi {{userName}},</p><p>Order {{orderId}} has been marked refunded.</p><p>{{brandName}}</p>', 'Dedicated server order refunded\n\nHi {{userName}},\n\nOrder {{orderId}} has been marked refunded.\n\n{{brandName}}', true, 'migration')
ON CONFLICT ("key") DO NOTHING;
