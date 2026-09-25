-- Enterprise infra telemetry, DB-first analytics, system settings, and alerts.

ALTER TABLE "analytics_events" ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "analytics_events" ADD COLUMN IF NOT EXISTS "page" TEXT;
ALTER TABLE "analytics_events" ADD COLUMN IF NOT EXISTS "path" TEXT;
ALTER TABLE "analytics_events" ADD COLUMN IF NOT EXISTS "device" TEXT;
ALTER TABLE "analytics_events" ADD COLUMN IF NOT EXISTS "browser" TEXT;
ALTER TABLE "analytics_events" ADD COLUMN IF NOT EXISTS "os" TEXT;
ALTER TABLE "analytics_events" ADD COLUMN IF NOT EXISTS "ipHash" TEXT;
ALTER TABLE "analytics_events" ADD COLUMN IF NOT EXISTS "metadata" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS "analytics_sessions" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "userId" TEXT,
  "ipHash" TEXT,
  "userAgent" TEXT,
  "device" TEXT,
  "browser" TEXT,
  "os" TEXT,
  "country" TEXT,
  "city" TEXT,
  "referrer" TEXT,
  "firstPath" TEXT,
  "lastPath" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "analytics_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "analytics_page_views" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "sessionId" TEXT NOT NULL,
  "page" TEXT,
  "path" TEXT NOT NULL,
  "referrer" TEXT,
  "trafficSource" TEXT,
  "utmSource" TEXT,
  "utmMedium" TEXT,
  "device" TEXT,
  "browser" TEXT,
  "os" TEXT,
  "country" TEXT,
  "city" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "analytics_page_views_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "analytics_devices" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "userId" TEXT,
  "device" TEXT,
  "browser" TEXT,
  "os" TEXT,
  "userAgent" TEXT,
  "ipHash" TEXT,
  "country" TEXT,
  "city" TEXT,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "analytics_devices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "analytics_conversions" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "sessionId" TEXT,
  "eventId" TEXT,
  "conversionType" TEXT NOT NULL,
  "orderId" TEXT,
  "paymentId" TEXT,
  "vpsInstanceId" TEXT,
  "amount" DECIMAL(10,2),
  "currency" TEXT,
  "status" TEXT NOT NULL DEFAULT 'recorded',
  "source" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "analytics_conversions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "system_settings" (
  "id" TEXT NOT NULL,
  "siteName" TEXT,
  "brandName" TEXT,
  "supportEmail" TEXT,
  "smtpHost" TEXT,
  "smtpPort" INTEGER,
  "smtpSecure" BOOLEAN NOT NULL DEFAULT false,
  "smtpUser" TEXT,
  "smtpPassEncrypted" TEXT,
  "smtpFrom" TEXT,
  "googleAnalyticsId" TEXT,
  "cashfreeAppId" TEXT,
  "cashfreeSecretEncrypted" TEXT,
  "cashfreeWebhookSecretEncrypted" TEXT,
  "phonepeMerchantId" TEXT,
  "phonepeSaltEncrypted" TEXT,
  "phonepeSaltIndex" TEXT,
  "phonepeWebhookSecretEncrypted" TEXT,
  "proxmoxHost" TEXT,
  "proxmoxNode" TEXT,
  "proxmoxTokenId" TEXT,
  "proxmoxTokenSecretEncrypted" TEXT,
  "proxmoxVerifyTls" BOOLEAN NOT NULL DEFAULT true,
  "proxmoxVncUser" TEXT,
  "proxmoxVncPasswordEncrypted" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "node_metrics" (
  "id" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "cpuUsage" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "ramUsage" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "diskUsage" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "diskRead" BIGINT NOT NULL DEFAULT 0,
  "diskWrite" BIGINT NOT NULL DEFAULT 0,
  "networkIn" BIGINT NOT NULL DEFAULT 0,
  "networkOut" BIGINT NOT NULL DEFAULT 0,
  "load1" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "load5" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "load15" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "uptime" BIGINT NOT NULL DEFAULT 0,
  "runningVms" INTEGER NOT NULL DEFAULT 0,
  "stoppedVms" INTEGER NOT NULL DEFAULT 0,
  "storageUsed" BIGINT NOT NULL DEFAULT 0,
  "storageFree" BIGINT NOT NULL DEFAULT 0,
  "temperature" DOUBLE PRECISION,
  "latencyMs" INTEGER,
  "activeTasks" INTEGER NOT NULL DEFAULT 0,
  "taskQueue" INTEGER NOT NULL DEFAULT 0,
  "health" TEXT NOT NULL DEFAULT 'connected',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "node_metrics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "node_metric_hourly" (
  "id" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "bucketAt" TIMESTAMP(3) NOT NULL,
  "samples" INTEGER NOT NULL DEFAULT 0,
  "cpuAvg" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "cpuMax" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "ramAvg" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "ramMax" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "diskAvg" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "diskMax" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "networkInSum" BIGINT NOT NULL DEFAULT 0,
  "networkOutSum" BIGINT NOT NULL DEFAULT 0,
  "diskReadSum" BIGINT NOT NULL DEFAULT 0,
  "diskWriteSum" BIGINT NOT NULL DEFAULT 0,
  "runningVmsAvg" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "stoppedVmsAvg" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "node_metric_hourly_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "system_alerts" (
  "id" TEXT NOT NULL,
  "alertType" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'warning',
  "status" TEXT NOT NULL DEFAULT 'open',
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "nodeId" TEXT,
  "vpsInstanceId" TEXT,
  "paymentId" TEXT,
  "queueName" TEXT,
  "dedupeKey" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "system_alerts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "analytics_sessions_sessionId_key" ON "analytics_sessions"("sessionId");
CREATE UNIQUE INDEX IF NOT EXISTS "analytics_devices_sessionId_key" ON "analytics_devices"("sessionId");
CREATE UNIQUE INDEX IF NOT EXISTS "node_metric_hourly_nodeId_bucketAt_key" ON "node_metric_hourly"("nodeId", "bucketAt");
CREATE UNIQUE INDEX IF NOT EXISTS "system_alerts_dedupeKey_key" ON "system_alerts"("dedupeKey");

CREATE INDEX IF NOT EXISTS "analytics_events_userId_idx" ON "analytics_events"("userId");
CREATE INDEX IF NOT EXISTS "analytics_events_sessionId_createdAt_idx" ON "analytics_events"("sessionId", "createdAt");
CREATE INDEX IF NOT EXISTS "analytics_events_path_createdAt_idx" ON "analytics_events"("path", "createdAt");
CREATE INDEX IF NOT EXISTS "analytics_events_ipHash_createdAt_idx" ON "analytics_events"("ipHash", "createdAt");
CREATE INDEX IF NOT EXISTS "analytics_sessions_userId_idx" ON "analytics_sessions"("userId");
CREATE INDEX IF NOT EXISTS "analytics_sessions_lastSeenAt_idx" ON "analytics_sessions"("lastSeenAt");
CREATE INDEX IF NOT EXISTS "analytics_sessions_ipHash_lastSeenAt_idx" ON "analytics_sessions"("ipHash", "lastSeenAt");
CREATE INDEX IF NOT EXISTS "analytics_page_views_sessionId_createdAt_idx" ON "analytics_page_views"("sessionId", "createdAt");
CREATE INDEX IF NOT EXISTS "analytics_page_views_path_createdAt_idx" ON "analytics_page_views"("path", "createdAt");
CREATE INDEX IF NOT EXISTS "analytics_page_views_userId_createdAt_idx" ON "analytics_page_views"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "analytics_page_views_createdAt_idx" ON "analytics_page_views"("createdAt");
CREATE INDEX IF NOT EXISTS "analytics_devices_device_idx" ON "analytics_devices"("device");
CREATE INDEX IF NOT EXISTS "analytics_devices_browser_idx" ON "analytics_devices"("browser");
CREATE INDEX IF NOT EXISTS "analytics_devices_os_idx" ON "analytics_devices"("os");
CREATE INDEX IF NOT EXISTS "analytics_devices_country_idx" ON "analytics_devices"("country");
CREATE INDEX IF NOT EXISTS "analytics_conversions_conversionType_createdAt_idx" ON "analytics_conversions"("conversionType", "createdAt");
CREATE INDEX IF NOT EXISTS "analytics_conversions_userId_createdAt_idx" ON "analytics_conversions"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "analytics_conversions_sessionId_createdAt_idx" ON "analytics_conversions"("sessionId", "createdAt");
CREATE INDEX IF NOT EXISTS "analytics_conversions_orderId_idx" ON "analytics_conversions"("orderId");
CREATE INDEX IF NOT EXISTS "analytics_conversions_paymentId_idx" ON "analytics_conversions"("paymentId");
CREATE INDEX IF NOT EXISTS "system_settings_active_idx" ON "system_settings"("active");
CREATE INDEX IF NOT EXISTS "node_metrics_nodeId_recordedAt_idx" ON "node_metrics"("nodeId", "recordedAt");
CREATE INDEX IF NOT EXISTS "node_metrics_recordedAt_idx" ON "node_metrics"("recordedAt");
CREATE INDEX IF NOT EXISTS "node_metric_hourly_bucketAt_idx" ON "node_metric_hourly"("bucketAt");
CREATE INDEX IF NOT EXISTS "system_alerts_status_severity_lastSeenAt_idx" ON "system_alerts"("status", "severity", "lastSeenAt");
CREATE INDEX IF NOT EXISTS "system_alerts_alertType_status_idx" ON "system_alerts"("alertType", "status");
CREATE INDEX IF NOT EXISTS "system_alerts_nodeId_status_idx" ON "system_alerts"("nodeId", "status");
CREATE INDEX IF NOT EXISTS "vm_network_events_vpsInstanceId_createdAt_idx" ON "vm_network_events"("vpsInstanceId", "createdAt");
CREATE INDEX IF NOT EXISTS "audit_logs_adminId_createdAt_idx" ON "audit_logs"("adminId", "createdAt");

ALTER TABLE "node_metrics" ADD CONSTRAINT "node_metrics_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "proxmox_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "node_metric_hourly" ADD CONSTRAINT "node_metric_hourly_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "proxmox_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
