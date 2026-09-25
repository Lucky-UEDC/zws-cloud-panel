-- VmBackupPolicy for Proxmox VM backup scheduling and retention
CREATE TABLE "vm_backup_policies" (
    "id" text NOT NULL,
    "name" text NOT NULL,
    "node_id" text,
    "storage" text NOT NULL,
    "schedule_minutes" integer NOT NULL DEFAULT 60,
    "retention" integer NOT NULL DEFAULT 5,
    "include_vms" json NOT NULL DEFAULT '[]',
    "mode" text NOT NULL DEFAULT 'snapshot',
    "compress" text,
    "notify" text NOT NULL DEFAULT 'disabled',
    "is_enabled" boolean NOT NULL DEFAULT true,
    "next_run_at" timestamp(3) WITHOUT TIME ZONE,
    "last_run_at" timestamp(3) WITHOUT TIME ZONE,
    "last_status" text,
    "last_error" text,
    "metadata" json NOT NULL DEFAULT '{}',
    "created_by" text,
    "created_at" timestamp(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamp(3) WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT "vm_backup_policies_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "vm_backup_policies_is_enabled_next_run_at_idx" ON "vm_backup_policies" ("is_enabled", "next_run_at");