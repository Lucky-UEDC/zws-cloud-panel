-- The 17 tables below (vm_addon_plans, vm_addon_node_prices, vm_addon_pool_prices,
-- vm_addons, vm_addon_purchases, vm_addon_worker_tasks, vm_audit_logs, vm_backups,
-- vm_bandwidth_usage, vm_ip_history, vm_metrics_cache, vm_network, vm_network_cache,
-- vm_runtime, vm_snapshots, vm_state_cache, vm_usage_history) were created out-of-band
-- and referenced throughout lib/vm-addons.ts, lib/vm-db-truth.ts, lib/vps-control.ts,
-- and various admin API routes via `(prisma as any).vmAddon` etc., but were never
-- declared as Prisma models — same root cause as ip_assignments/ip_history
-- (see 20260630210000_add_missing_ip_assignment_history_models). Every call site threw
-- synchronously, silently breaking VM addons, backups, snapshots, bandwidth tracking,
-- audit logging, and runtime/network/state caching in production.
--
-- database_registry and tenant_database_mappings are NOT included here — they already
-- have a tracked migration (20260616_database_registry) and exist; only their Prisma
-- models (DatabaseRegistry, TenantDatabaseMapping) were missing, fixed in schema.prisma.
--
-- This migration is idempotent and matches the existing production table structure
-- exactly (no-op there); it exists so fresh environments end up with the same schema.

CREATE TABLE IF NOT EXISTS "vm_addon_plans" (
  "id" TEXT NOT NULL,
  "addon_type" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "unit" TEXT,
  "quantity" DECIMAL(65,30),
  "currency" TEXT NOT NULL DEFAULT 'INR'::text,
  "base_price" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "tax_percent" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "recurring" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vm_addon_plans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "vm_addon_plans_slug_key" ON "vm_addon_plans"("slug");
CREATE INDEX IF NOT EXISTS "vm_addon_plans_addon_type_active_idx" ON "vm_addon_plans"("addon_type", "active");

CREATE TABLE IF NOT EXISTS "vm_addon_node_prices" (
  "id" TEXT NOT NULL,
  "addon_plan_id" TEXT NOT NULL,
  "proxmox_node_id" TEXT NOT NULL,
  "price" DECIMAL(65,30) NOT NULL,
  "tax_percent" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'INR'::text,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vm_addon_node_prices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "vm_addon_node_prices_addon_plan_id_proxmox_node_id_key" ON "vm_addon_node_prices"("addon_plan_id", "proxmox_node_id");
CREATE INDEX IF NOT EXISTS "vm_addon_node_prices_proxmox_node_id_active_idx" ON "vm_addon_node_prices"("proxmox_node_id", "active");

CREATE TABLE IF NOT EXISTS "vm_addon_pool_prices" (
  "id" TEXT NOT NULL,
  "addon_plan_id" TEXT NOT NULL,
  "pool_id" TEXT NOT NULL,
  "price" DECIMAL(65,30) NOT NULL,
  "tax_percent" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'INR'::text,
  "available" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vm_addon_pool_prices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "vm_addon_pool_prices_addon_plan_id_pool_id_key" ON "vm_addon_pool_prices"("addon_plan_id", "pool_id");
CREATE INDEX IF NOT EXISTS "vm_addon_pool_prices_pool_id_available_idx" ON "vm_addon_pool_prices"("pool_id", "available");

CREATE TABLE IF NOT EXISTS "vm_addons" (
  "id" TEXT NOT NULL,
  "vps_instance_id" TEXT NOT NULL,
  "customer_id" TEXT,
  "purchase_id" TEXT,
  "addon_plan_id" TEXT,
  "addon_type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active'::text,
  "quota" DECIMAL(65,30),
  "unit" TEXT,
  "used" DECIMAL(65,30),
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "activated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vm_addons_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "vm_addons_vps_instance_id_addon_type_status_idx" ON "vm_addons"("vps_instance_id", "addon_type", "status");
CREATE INDEX IF NOT EXISTS "vm_addons_customer_id_status_idx" ON "vm_addons"("customer_id", "status");

CREATE TABLE IF NOT EXISTS "vm_addon_purchases" (
  "id" TEXT NOT NULL,
  "addon_plan_id" TEXT NOT NULL,
  "addon_type" TEXT NOT NULL,
  "vps_instance_id" TEXT NOT NULL,
  "customer_id" TEXT,
  "order_id" TEXT,
  "invoice_id" TEXT,
  "payment_id" TEXT,
  "proxmox_node_id" TEXT,
  "pool_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending'::text,
  "quantity" DECIMAL(65,30),
  "unit" TEXT,
  "amount" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "tax_amount" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'INR'::text,
  "effective_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "idempotency_key" TEXT,
  CONSTRAINT "vm_addon_purchases_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "vm_addon_purchases_vps_instance_id_status_idx" ON "vm_addon_purchases"("vps_instance_id", "status");
CREATE INDEX IF NOT EXISTS "vm_addon_purchases_customer_id_status_idx" ON "vm_addon_purchases"("customer_id", "status");
CREATE INDEX IF NOT EXISTS "vm_addon_purchases_addon_type_status_idx" ON "vm_addon_purchases"("addon_type", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "vm_addon_purchases_idempotency_key_key" ON "vm_addon_purchases"("idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "vm_addon_purchases_pending_plan_pool_unique_idx" ON "vm_addon_purchases" ("customer_id", "vps_instance_id", "addon_plan_id", COALESCE("pool_id", '__none__'::text)) WHERE (lower(status) = ANY (ARRAY['pending'::text, 'pending_payment'::text]));

CREATE TABLE IF NOT EXISTS "vm_addon_worker_tasks" (
  "id" TEXT NOT NULL,
  "purchase_id" TEXT,
  "addon_type" TEXT NOT NULL,
  "vps_instance_id" TEXT NOT NULL,
  "proxmox_node_id" TEXT,
  "vmid" INTEGER,
  "action" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued'::text,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 3,
  "run_after" TIMESTAMP(3),
  "locked_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "error" TEXT,
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "result" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vm_addon_worker_tasks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "vm_addon_worker_tasks_status_run_after_created_at_idx" ON "vm_addon_worker_tasks"("status", "run_after", "created_at");
CREATE INDEX IF NOT EXISTS "vm_addon_worker_tasks_vps_instance_id_status_idx" ON "vm_addon_worker_tasks"("vps_instance_id", "status");

CREATE TABLE IF NOT EXISTS "vm_audit_logs" (
  "id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'INFO'::text,
  "actor_type" TEXT,
  "actor_id" TEXT,
  "actor_email" TEXT,
  "vps_instance_id" TEXT,
  "customer_id" TEXT,
  "order_id" TEXT,
  "proxmox_node_id" TEXT,
  "vmid" INTEGER,
  "ip_address" TEXT,
  "target_type" TEXT,
  "target_id" TEXT,
  "old_value" JSONB,
  "new_value" JSONB,
  "reason" TEXT,
  "status" TEXT NOT NULL DEFAULT 'SUCCESS'::text,
  "correlation_id" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vm_audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "vm_audit_logs_vps_instance_id_created_at_idx" ON "vm_audit_logs"("vps_instance_id", "created_at");
CREATE INDEX IF NOT EXISTS "vm_audit_logs_customer_id_created_at_idx" ON "vm_audit_logs"("customer_id", "created_at");
CREATE INDEX IF NOT EXISTS "vm_audit_logs_event_type_created_at_idx" ON "vm_audit_logs"("event_type", "created_at");
CREATE INDEX IF NOT EXISTS "vm_audit_logs_ip_address_created_at_idx" ON "vm_audit_logs"("ip_address", "created_at");

CREATE TABLE IF NOT EXISTS "vm_backups" (
  "id" TEXT NOT NULL,
  "vps_instance_id" TEXT NOT NULL,
  "customer_id" TEXT,
  "proxmox_node_id" TEXT,
  "vmid" INTEGER,
  "purchase_id" TEXT,
  "schedule" TEXT,
  "status" TEXT NOT NULL DEFAULT 'queued'::text,
  "destination" TEXT,
  "backup_path" TEXT,
  "size_bytes" BIGINT,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vm_backups_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "vm_backups_vps_instance_id_status_idx" ON "vm_backups"("vps_instance_id", "status");
CREATE INDEX IF NOT EXISTS "vm_backups_proxmox_node_id_vmid_idx" ON "vm_backups"("proxmox_node_id", "vmid");

CREATE TABLE IF NOT EXISTS "vm_bandwidth_usage" (
  "id" TEXT NOT NULL,
  "vps_instance_id" TEXT NOT NULL,
  "customer_id" TEXT,
  "product_id" TEXT,
  "proxmox_node_id" TEXT,
  "ip_address" TEXT,
  "vmid" INTEGER,
  "period" TEXT NOT NULL DEFAULT 'sample'::text,
  "bucket_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rx_bytes" BIGINT NOT NULL DEFAULT 0,
  "tx_bytes" BIGINT NOT NULL DEFAULT 0,
  "total_bytes" BIGINT NOT NULL DEFAULT 0,
  "rx_rate_bps" BIGINT NOT NULL DEFAULT 0,
  "tx_rate_bps" BIGINT NOT NULL DEFAULT 0,
  "peak_rate_bps" BIGINT NOT NULL DEFAULT 0,
  "included_bytes" BIGINT NOT NULL DEFAULT 0,
  "billable_bytes" BIGINT NOT NULL DEFAULT 0,
  "source" TEXT NOT NULL DEFAULT 'worker'::text,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vm_bandwidth_usage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "vm_bandwidth_usage_vps_instance_id_bucket_at_idx" ON "vm_bandwidth_usage"("vps_instance_id", "bucket_at");
CREATE INDEX IF NOT EXISTS "vm_bandwidth_usage_customer_id_bucket_at_idx" ON "vm_bandwidth_usage"("customer_id", "bucket_at");
CREATE INDEX IF NOT EXISTS "vm_bandwidth_usage_proxmox_node_id_bucket_at_idx" ON "vm_bandwidth_usage"("proxmox_node_id", "bucket_at");
CREATE INDEX IF NOT EXISTS "vm_bandwidth_usage_ip_address_bucket_at_idx" ON "vm_bandwidth_usage"("ip_address", "bucket_at");
CREATE INDEX IF NOT EXISTS "vm_bandwidth_usage_period_bucket_at_idx" ON "vm_bandwidth_usage"("period", "bucket_at");

CREATE TABLE IF NOT EXISTS "vm_ip_history" (
  "id" TEXT NOT NULL,
  "ip" TEXT NOT NULL,
  "vps_instance_id" TEXT,
  "vmid" INTEGER,
  "customer_id" TEXT,
  "customer_email" TEXT,
  "pool_id" TEXT,
  "pool_name" TEXT,
  "node_id" TEXT,
  "node_name" TEXT,
  "assignment_id" TEXT,
  "allocation_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active'::text,
  "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "released_at" TIMESTAMP(3),
  "days_used" INTEGER,
  "reason" TEXT,
  "admin" TEXT,
  "source" TEXT NOT NULL DEFAULT 'database'::text,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vm_ip_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "vm_ip_history_ip_assigned_at_idx" ON "vm_ip_history"("ip", "assigned_at");
CREATE INDEX IF NOT EXISTS "vm_ip_history_vps_instance_id_assigned_at_idx" ON "vm_ip_history"("vps_instance_id", "assigned_at");
CREATE INDEX IF NOT EXISTS "vm_ip_history_customer_id_assigned_at_idx" ON "vm_ip_history"("customer_id", "assigned_at");
CREATE INDEX IF NOT EXISTS "vm_ip_history_pool_id_status_idx" ON "vm_ip_history"("pool_id", "status");
CREATE INDEX IF NOT EXISTS "vm_ip_history_node_id_vmid_idx" ON "vm_ip_history"("node_id", "vmid");

CREATE TABLE IF NOT EXISTS "vm_metrics_cache" (
  "id" TEXT NOT NULL,
  "vps_instance_id" TEXT NOT NULL,
  "proxmox_node_id" TEXT,
  "vmid" INTEGER,
  "runtime_status" TEXT,
  "cpu_percent" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "ram_used_bytes" BIGINT NOT NULL DEFAULT 0,
  "ram_total_bytes" BIGINT NOT NULL DEFAULT 0,
  "disk_used_bytes" BIGINT NOT NULL DEFAULT 0,
  "disk_total_bytes" BIGINT NOT NULL DEFAULT 0,
  "disk_read_bytes" BIGINT NOT NULL DEFAULT 0,
  "disk_write_bytes" BIGINT NOT NULL DEFAULT 0,
  "network_in_bytes" BIGINT NOT NULL DEFAULT 0,
  "network_out_bytes" BIGINT NOT NULL DEFAULT 0,
  "rx_rate_bps" BIGINT NOT NULL DEFAULT 0,
  "tx_rate_bps" BIGINT NOT NULL DEFAULT 0,
  "uptime_seconds" BIGINT NOT NULL DEFAULT 0,
  "source" TEXT NOT NULL DEFAULT 'worker'::text,
  "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "stale_after" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "disk_free_bytes" BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT "vm_metrics_cache_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "vm_metrics_cache_vps_instance_id_key" ON "vm_metrics_cache"("vps_instance_id");
CREATE INDEX IF NOT EXISTS "vm_metrics_cache_recorded_at_idx" ON "vm_metrics_cache"("recorded_at");
CREATE INDEX IF NOT EXISTS "vm_metrics_cache_stale_after_idx" ON "vm_metrics_cache"("stale_after");
CREATE INDEX IF NOT EXISTS "vm_metrics_cache_proxmox_node_id_vmid_idx" ON "vm_metrics_cache"("proxmox_node_id", "vmid");

CREATE TABLE IF NOT EXISTS "vm_network" (
  "id" TEXT NOT NULL,
  "vps_instance_id" TEXT NOT NULL,
  "customer_id" TEXT,
  "proxmox_node_id" TEXT,
  "vmid" INTEGER,
  "primary_assigned_ip" TEXT,
  "primary_assignment_id" TEXT,
  "primary_pool_id" TEXT,
  "primary_allocation_id" TEXT,
  "primary_gateway" TEXT,
  "primary_cidr" INTEGER,
  "primary_dns" TEXT,
  "primary_bridge" TEXT,
  "additional_ips" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "cloud_init_ip" TEXT,
  "discovered_ip" TEXT,
  "proxmox_ip" TEXT,
  "diagnostic_only" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "source" TEXT NOT NULL DEFAULT 'database'::text,
  "imported_at" TIMESTAMP(3),
  "last_synced_at" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vm_network_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "vm_network_vps_instance_id_key" ON "vm_network"("vps_instance_id");
CREATE INDEX IF NOT EXISTS "vm_network_customer_id_idx" ON "vm_network"("customer_id");
CREATE INDEX IF NOT EXISTS "vm_network_primary_assigned_ip_idx" ON "vm_network"("primary_assigned_ip");
CREATE INDEX IF NOT EXISTS "vm_network_primary_pool_id_idx" ON "vm_network"("primary_pool_id");
CREATE INDEX IF NOT EXISTS "vm_network_proxmox_node_id_vmid_idx" ON "vm_network"("proxmox_node_id", "vmid");

CREATE TABLE IF NOT EXISTS "vm_network_cache" (
  "id" TEXT NOT NULL,
  "vps_instance_id" TEXT NOT NULL,
  "customer_id" TEXT,
  "proxmox_node_id" TEXT,
  "vmid" INTEGER,
  "primary_assigned_ip" TEXT,
  "primary_assignment_id" TEXT,
  "primary_pool_id" TEXT,
  "primary_allocation_id" TEXT,
  "primary_gateway" TEXT,
  "primary_cidr" INTEGER,
  "primary_dns" TEXT,
  "primary_bridge" TEXT,
  "additional_ips" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "cloud_init_ip" TEXT,
  "discovered_ip" TEXT,
  "proxmox_ip" TEXT,
  "diagnostic_only" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "source" TEXT NOT NULL DEFAULT 'database'::text,
  "imported_at" TIMESTAMP(3),
  "last_synced_at" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vm_network_cache_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "vm_network_cache_vps_instance_id_key" ON "vm_network_cache"("vps_instance_id");
CREATE INDEX IF NOT EXISTS "vm_network_cache_customer_id_idx" ON "vm_network_cache"("customer_id");
CREATE INDEX IF NOT EXISTS "vm_network_cache_primary_assigned_ip_idx" ON "vm_network_cache"("primary_assigned_ip");
CREATE INDEX IF NOT EXISTS "vm_network_cache_primary_pool_id_idx" ON "vm_network_cache"("primary_pool_id");
CREATE INDEX IF NOT EXISTS "vm_network_cache_proxmox_node_id_vmid_idx" ON "vm_network_cache"("proxmox_node_id", "vmid");

CREATE TABLE IF NOT EXISTS "vm_runtime" (
  "id" TEXT NOT NULL,
  "vps_instance_id" TEXT NOT NULL,
  "customer_id" TEXT,
  "order_id" TEXT,
  "proxmox_node_id" TEXT,
  "vmid" INTEGER,
  "hostname" TEXT,
  "status" TEXT NOT NULL DEFAULT 'UNKNOWN'::text,
  "runtime_status" TEXT,
  "power_state" TEXT,
  "cpu_cores" INTEGER,
  "ram_gb" INTEGER,
  "disk_gb" INTEGER,
  "bandwidth_tb" DECIMAL(65,30),
  "region" TEXT,
  "node_name" TEXT,
  "billing_status" TEXT,
  "sync_source" TEXT NOT NULL DEFAULT 'database'::text,
  "last_synced_at" TIMESTAMP(3),
  "stale_after" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vm_runtime_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "vm_runtime_vps_instance_id_key" ON "vm_runtime"("vps_instance_id");
CREATE INDEX IF NOT EXISTS "vm_runtime_customer_id_status_idx" ON "vm_runtime"("customer_id", "status");
CREATE INDEX IF NOT EXISTS "vm_runtime_proxmox_node_id_vmid_idx" ON "vm_runtime"("proxmox_node_id", "vmid");
CREATE INDEX IF NOT EXISTS "vm_runtime_last_synced_at_idx" ON "vm_runtime"("last_synced_at");

CREATE TABLE IF NOT EXISTS "vm_snapshots" (
  "id" TEXT NOT NULL,
  "vps_instance_id" TEXT NOT NULL,
  "customer_id" TEXT,
  "proxmox_node_id" TEXT,
  "vmid" INTEGER,
  "purchase_id" TEXT,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued'::text,
  "size_bytes" BIGINT,
  "created_by" TEXT,
  "created_on_node_at" TIMESTAMP(3),
  "deleted_at" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vm_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "vm_snapshots_vps_instance_id_status_idx" ON "vm_snapshots"("vps_instance_id", "status");
CREATE INDEX IF NOT EXISTS "vm_snapshots_proxmox_node_id_vmid_idx" ON "vm_snapshots"("proxmox_node_id", "vmid");

CREATE TABLE IF NOT EXISTS "vm_state_cache" (
  "id" TEXT NOT NULL,
  "vps_instance_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'UNKNOWN'::text,
  "runtime_status" TEXT,
  "power_state" TEXT,
  "sync_status" TEXT NOT NULL DEFAULT 'pending'::text,
  "sync_source" TEXT NOT NULL DEFAULT 'database'::text,
  "last_synced_at" TIMESTAMP(3),
  "stale_after" TIMESTAMP(3),
  "last_error" TEXT,
  "proxmox_state" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "database_state" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vm_state_cache_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "vm_state_cache_vps_instance_id_key" ON "vm_state_cache"("vps_instance_id");
CREATE INDEX IF NOT EXISTS "vm_state_cache_sync_status_last_synced_at_idx" ON "vm_state_cache"("sync_status", "last_synced_at");
CREATE INDEX IF NOT EXISTS "vm_state_cache_status_idx" ON "vm_state_cache"("status");

CREATE TABLE IF NOT EXISTS "vm_usage_history" (
  "id" TEXT NOT NULL,
  "vm_id" TEXT NOT NULL,
  "cpu_percent" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "ram_used" BIGINT NOT NULL DEFAULT 0,
  "ram_total" BIGINT NOT NULL DEFAULT 0,
  "disk_used" BIGINT NOT NULL DEFAULT 0,
  "disk_total" BIGINT NOT NULL DEFAULT 0,
  "network_in" BIGINT NOT NULL DEFAULT 0,
  "network_out" BIGINT NOT NULL DEFAULT 0,
  "runtime_status" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vm_usage_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "vm_usage_history_vm_id_created_at_idx" ON "vm_usage_history"("vm_id", "created_at");
CREATE INDEX IF NOT EXISTS "vm_usage_history_created_at_idx" ON "vm_usage_history"("created_at");
