-- Backup plan product catalog (customer-level backup entitlements)
CREATE TABLE "backup_plans" (
    "id" text NOT NULL,
    "name" text NOT NULL,
    "slug" text NOT NULL,
    "description" text,
    "active" boolean NOT NULL DEFAULT true,
    "archived" boolean NOT NULL DEFAULT false,
    "featured" boolean NOT NULL DEFAULT false,
    "price" numeric(10, 2) NOT NULL DEFAULT 0,
    "currency" text NOT NULL DEFAULT 'INR',
    "billing_cycle" text NOT NULL DEFAULT 'monthly',
    "tax_percent" numeric(5, 2) NOT NULL DEFAULT 18,
    "max_backups" integer NOT NULL DEFAULT 10,
    "storage_quota_gb" integer NOT NULL DEFAULT 100,
    "manual_backup_enabled" boolean NOT NULL DEFAULT true,
    "automatic_backup_enabled" boolean NOT NULL DEFAULT true,
    "schedule_options" json NOT NULL DEFAULT '[]',
    "retention_count" integer NOT NULL DEFAULT 10,
    "restore_enabled" boolean NOT NULL DEFAULT true,
    "download_enabled" boolean NOT NULL DEFAULT false,
    "overage_enabled" boolean NOT NULL DEFAULT true,
    "overage_price_per_gb" numeric(10, 2) NOT NULL DEFAULT 0,
    "extra_storage_price_per_gb" numeric(10, 2) NOT NULL DEFAULT 0,
    "grace_period_days" integer NOT NULL DEFAULT 3,
    "max_storage_cap_gb" integer,
    "metadata" json NOT NULL DEFAULT '{}',
    "created_at" timestamp(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamp(3) WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT "backup_plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "backup_plans_slug_key" ON "backup_plans" ("slug");
CREATE INDEX "backup_plans_active_archived_idx" ON "backup_plans" ("active", "archived");

-- A customer's purchased backup entitlement attached to a BackupPlan.
CREATE TABLE "backup_subscriptions" (
    "id" text NOT NULL,
    "customer_id" text NOT NULL,
    "plan_id" text NOT NULL,
    "order_id" text,
    "invoice_id" text,
    "status" text NOT NULL DEFAULT 'active',
    "started_at" timestamp(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" timestamp(3) WITHOUT TIME ZONE,
    "grace_ends_at" timestamp(3) WITHOUT TIME ZONE,
    "auto_renew" boolean NOT NULL DEFAULT true,
    "term_months" integer NOT NULL DEFAULT 1,
    "upgrade_storage_gb" integer NOT NULL DEFAULT 0,
    "extra_storage_price_per_gb" numeric(10, 2) NOT NULL DEFAULT 0,
    "grandfathered" boolean NOT NULL DEFAULT false,
    "metadata" json NOT NULL DEFAULT '{}',
    "created_at" timestamp(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamp(3) WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT "backup_subscriptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "backup_subscriptions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "backup_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "backup_plans" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "backup_subscriptions_customer_id_status_idx" ON "backup_subscriptions" ("customer_id", "status");
CREATE INDEX "backup_subscriptions_status_expires_at_idx" ON "backup_subscriptions" ("status", "expires_at");

-- Period snapshot of a subscription's storage/count consumption.
CREATE TABLE "backup_usage" (
    "id" text NOT NULL,
    "subscription_id" text NOT NULL,
    "customer_id" text NOT NULL,
    "period_start" timestamp(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "period_end" timestamp(3) WITHOUT TIME ZONE,
    "used_bytes" bigint NOT NULL DEFAULT 0,
    "backup_count" integer NOT NULL DEFAULT 0,
    "quota_gb" integer NOT NULL DEFAULT 0,
    "overage_gb" numeric(10, 2) NOT NULL DEFAULT 0,
    "computed_at" timestamp(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" json NOT NULL DEFAULT '{}',
    CONSTRAINT "backup_usage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "backup_usage_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "backup_subscriptions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "backup_usage_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "backup_usage_subscription_id_period_start_period_end_idx" ON "backup_usage" ("subscription_id", "period_start", "period_end");
CREATE INDEX "backup_usage_customer_id_computed_at_idx" ON "backup_usage" ("customer_id", "computed_at");

-- Generated billable overage line for a subscription period.
CREATE TABLE "backup_overages" (
    "id" text NOT NULL,
    "subscription_id" text NOT NULL,
    "customer_id" text NOT NULL,
    "period_start" timestamp(3) WITHOUT TIME ZONE NOT NULL,
    "period_end" timestamp(3) WITHOUT TIME ZONE NOT NULL,
    "used_bytes" bigint NOT NULL,
    "quota_bytes" bigint NOT NULL,
    "overage_gb" numeric(10, 2) NOT NULL DEFAULT 0,
    "rate_per_gb" numeric(10, 2) NOT NULL DEFAULT 0,
    "amount" numeric(10, 2) NOT NULL DEFAULT 0,
    "invoice_id" text,
    "status" text NOT NULL DEFAULT 'unbilled',
    "created_at" timestamp(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "backup_overages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "backup_overages_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "backup_subscriptions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "backup_overages_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "backup_overages_subscription_id_status_idx" ON "backup_overages" ("subscription_id", "status");
CREATE INDEX "backup_overages_customer_id_status_idx" ON "backup_overages" ("customer_id", "status");

-- Purchased extra backup storage on top of a plan's included quota.
CREATE TABLE "backup_storage_upgrades" (
    "id" text NOT NULL,
    "subscription_id" text NOT NULL,
    "customer_id" text NOT NULL,
    "gb" integer NOT NULL,
    "price_per_gb" numeric(10, 2) NOT NULL,
    "amount" numeric(10, 2) NOT NULL DEFAULT 0,
    "term_months" integer NOT NULL DEFAULT 1,
    "order_id" text,
    "invoice_id" text,
    "status" text NOT NULL DEFAULT 'pending',
    "effective_at" timestamp(3) WITHOUT TIME ZONE,
    "expires_at" timestamp(3) WITHOUT TIME ZONE,
    "created_at" timestamp(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "backup_storage_upgrades_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "backup_storage_upgrades_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "backup_subscriptions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "backup_storage_upgrades_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "backup_storage_upgrades_subscription_id_status_idx" ON "backup_storage_upgrades" ("subscription_id", "status");
CREATE INDEX "backup_storage_upgrades_customer_id_status_idx" ON "backup_storage_upgrades" ("customer_id", "status");

-- Snapshot billing product (independent from backup plans).
CREATE TABLE "snapshot_plans" (
    "id" text NOT NULL,
    "name" text NOT NULL,
    "slug" text NOT NULL,
    "description" text,
    "active" boolean NOT NULL DEFAULT true,
    "archived" boolean NOT NULL DEFAULT false,
    "model" text NOT NULL DEFAULT 'per_snapshot',
    "price" numeric(10, 2) NOT NULL DEFAULT 0,
    "currency" text NOT NULL DEFAULT 'INR',
    "billing_cycle" text NOT NULL DEFAULT 'monthly',
    "tax_percent" numeric(5, 2) NOT NULL DEFAULT 18,
    "included_snapshots" integer NOT NULL DEFAULT 0,
    "overage_snapshot_price" numeric(10, 2) NOT NULL DEFAULT 0,
    "max_snapshots" integer,
    "grace_period_days" integer NOT NULL DEFAULT 0,
    "restore_enabled" boolean NOT NULL DEFAULT true,
    "metadata" json NOT NULL DEFAULT '{}',
    "created_at" timestamp(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamp(3) WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT "snapshot_plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "snapshot_plans_slug_key" ON "snapshot_plans" ("slug");
CREATE INDEX "snapshot_plans_active_archived_idx" ON "snapshot_plans" ("active", "archived");

-- One billable snapshot charge (per SnapshotPlan price or per-snapshot pricing).
CREATE TABLE "snapshot_charges" (
    "id" text NOT NULL,
    "customer_id" text NOT NULL,
    "vps_instance_id" text NOT NULL,
    "snapshot_id" text,
    "plan_id" text,
    "order_id" text,
    "invoice_id" text,
    "payment_id" text,
    "amount" numeric(10, 2) NOT NULL DEFAULT 0,
    "tax_amount" numeric(10, 2) NOT NULL DEFAULT 0,
    "total_amount" numeric(10, 2) NOT NULL DEFAULT 0,
    "currency" text NOT NULL DEFAULT 'INR',
    "status" text NOT NULL DEFAULT 'unpaid',
    "snapshot_name" text,
    "metadata" json NOT NULL DEFAULT '{}',
    "created_at" timestamp(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "snapshot_charges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "snapshot_charges_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "snapshot_charges_vps_instance_id_fkey" FOREIGN KEY ("vps_instance_id") REFERENCES "vps_instances" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "snapshot_charges_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "snapshot_plans" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "snapshot_charges_customer_id_created_at_idx" ON "snapshot_charges" ("customer_id", "created_at");
CREATE INDEX "snapshot_charges_vps_instance_id_created_at_idx" ON "snapshot_charges" ("vps_instance_id", "created_at");
CREATE INDEX "snapshot_charges_snapshot_id_idx" ON "snapshot_charges" ("snapshot_id");

-- Admin-configurable gateway processing fees applied to credit top-ups.
CREATE TABLE "gateway_fee_configs" (
    "id" text NOT NULL,
    "gateway" text NOT NULL,
    "fee_percent" numeric(5, 2) NOT NULL DEFAULT 0,
    "fixed_fee" numeric(10, 2) NOT NULL DEFAULT 0,
    "enabled" boolean NOT NULL DEFAULT true,
    "min_amount" numeric(10, 2),
    "max_amount" numeric(10, 2),
    "updated_by" text,
    "created_at" timestamp(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamp(3) WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT "gateway_fee_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gateway_fee_configs_gateway_key" ON "gateway_fee_configs" ("gateway");

-- Extend wallet ledger with payment context for billable orders and top-up fees.
ALTER TABLE "wallet_transactions" ADD COLUMN "order_id" text;
ALTER TABLE "wallet_transactions" ADD COLUMN "currency" text NOT NULL DEFAULT 'INR';
ALTER TABLE "wallet_transactions" ADD COLUMN "gateway" text;
ALTER TABLE "wallet_transactions" ADD COLUMN "gateway_fee" numeric(10, 2);
CREATE INDEX "wallet_transactions_order_id_idx" ON "wallet_transactions" ("order_id");