-- Guest automation (qm guest / QEMU Guest Agent) — strictly additive.
--
-- ZWS Cloud no longer depends on cloud-init for customer VM configuration.
-- These tables back the OS-template driven guest engine:
--   guest_os_templates         one supported OS family/version
--   guest_operation_templates  per-OS operation definitions (commands)
--   vm_guest_adoptions         per-VM detected guest state + applied version
--   guest_automation_runs      a planned unit of guest work
--   guest_operation_runs       one executed step (audited, secrets never stored)
--   node_guest_capabilities    cached Proxmox node capability probe
--   guest_disk_samples         real, append-only disk telemetry
--
-- Every statement is IF NOT EXISTS so the migration is safe to rerun.

-- CreateTable
CREATE TABLE IF NOT EXISTS "guest_os_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "osIds" JSONB NOT NULL DEFAULT '[]',
    "versionPattern" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "guest_agent_required" BOOLEAN NOT NULL DEFAULT true,
    "engine" TEXT NOT NULL DEFAULT 'linux',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "last_tested_at" TIMESTAMP(3),
    "last_test_result" JSONB,
    "os_template_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guest_os_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "guest_operation_templates" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "command_type" TEXT NOT NULL DEFAULT 'guest-exec',
    "shell" TEXT NOT NULL DEFAULT 'linux-sh',
    "command" TEXT,
    "arguments" JSONB NOT NULL DEFAULT '[]',
    "timeout_seconds" INTEGER NOT NULL DEFAULT 30,
    "requires_running" BOOLEAN NOT NULL DEFAULT true,
    "requires_stopped" BOOLEAN NOT NULL DEFAULT false,
    "requires_guest_agent" BOOLEAN NOT NULL DEFAULT true,
    "reboot_required" BOOLEAN NOT NULL DEFAULT false,
    "danger_level" TEXT NOT NULL DEFAULT 'safe',
    "requires_confirmation" BOOLEAN NOT NULL DEFAULT false,
    "supports_rollback" BOOLEAN NOT NULL DEFAULT false,
    "verification_required" BOOLEAN NOT NULL DEFAULT true,
    "verification_command" TEXT,
    "verification_parser" TEXT,
    "success_condition" TEXT,
    "rollback_command" TEXT,
    "rollback_arguments" JSONB,
    "fallbacks" JSONB NOT NULL DEFAULT '[]',
    "state_key" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guest_operation_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "vm_guest_adoptions" (
    "id" TEXT NOT NULL,
    "vps_instance_id" TEXT NOT NULL,
    "os_template_id" TEXT,
    "guest_template_id" TEXT,
    "applied_template_version" INTEGER,
    "engine" TEXT NOT NULL DEFAULT 'unknown',
    "detected_os_id" TEXT,
    "detected_name" TEXT,
    "detected_version" TEXT,
    "detected_kernel_version" TEXT,
    "state" JSONB NOT NULL DEFAULT '{}',
    "automation_ready" BOOLEAN NOT NULL DEFAULT false,
    "guest_agent_reachable" BOOLEAN NOT NULL DEFAULT false,
    "guest_agent_checked_at" TIMESTAMP(3),
    "unsupported_reason" TEXT,
    "recovery_required" BOOLEAN NOT NULL DEFAULT false,
    "recovery_reason" TEXT,
    "last_detected_at" TIMESTAMP(3),
    "adopted_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vm_guest_adoptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "guest_automation_runs" (
    "id" TEXT NOT NULL,
    "vps_instance_id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "operations" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "current_step" TEXT,
    "template_id" TEXT,
    "template_version" INTEGER,
    "requested_by" TEXT,
    "requested_role" TEXT,
    "backup_point" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guest_automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "guest_operation_runs" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "vps_instance_id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "template_id" TEXT,
    "template_version" INTEGER,
    "command_type" TEXT,
    "shell" TEXT,
    "command_masked" TEXT,
    "status" TEXT NOT NULL,
    "changed" BOOLEAN NOT NULL DEFAULT false,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verification_ok" BOOLEAN NOT NULL DEFAULT false,
    "proxmox_upid" TEXT,
    "exit_code" INTEGER,
    "duration_ms" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "error_code" TEXT,
    "error" TEXT,
    "result" JSONB NOT NULL DEFAULT '{}',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guest_operation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "node_guest_capabilities" (
    "id" TEXT NOT NULL,
    "node_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "capabilities" JSONB NOT NULL DEFAULT '{}',
    "checks" JSONB NOT NULL DEFAULT '[]',
    "last_checked_at" TIMESTAMP(3),
    "last_success_at" TIMESTAMP(3),
    "last_error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "node_guest_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "guest_disk_samples" (
    "id" TEXT NOT NULL,
    "vps_instance_id" TEXT NOT NULL,
    "proxmox_node_id" TEXT,
    "vmid" INTEGER,
    "os" TEXT NOT NULL DEFAULT 'unknown',
    "engine" TEXT,
    "template_id" TEXT,
    "operation" TEXT NOT NULL DEFAULT 'disk_usage',
    "filesystem" TEXT,
    "total_bytes" BIGINT NOT NULL,
    "used_bytes" BIGINT NOT NULL,
    "free_bytes" BIGINT NOT NULL,
    "usedPercent" DECIMAL(6,2) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'guest-agent',
    "status" TEXT NOT NULL DEFAULT 'current',
    "error_code" TEXT,
    "error" TEXT,
    "collection_ms" INTEGER,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guest_disk_samples_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "guest_os_templates_slug_key" ON "guest_os_templates"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "guest_os_templates_os_template_id_key" ON "guest_os_templates"("os_template_id");
CREATE INDEX IF NOT EXISTS "guest_os_templates_family_engine_enabled_idx" ON "guest_os_templates"("family", "engine", "enabled");
CREATE INDEX IF NOT EXISTS "guest_os_templates_os_template_id_idx" ON "guest_os_templates"("os_template_id");
CREATE INDEX IF NOT EXISTS "guest_os_templates_enabled_priority_idx" ON "guest_os_templates"("enabled", "priority");
CREATE INDEX IF NOT EXISTS "guest_operation_templates_template_id_enabled_idx" ON "guest_operation_templates"("template_id", "enabled");
CREATE UNIQUE INDEX IF NOT EXISTS "guest_operation_templates_template_id_operation_key" ON "guest_operation_templates"("template_id", "operation");
CREATE UNIQUE INDEX IF NOT EXISTS "vm_guest_adoptions_vps_instance_id_key" ON "vm_guest_adoptions"("vps_instance_id");
CREATE INDEX IF NOT EXISTS "vm_guest_adoptions_guest_template_id_idx" ON "vm_guest_adoptions"("guest_template_id");
CREATE INDEX IF NOT EXISTS "vm_guest_adoptions_engine_automation_ready_idx" ON "vm_guest_adoptions"("engine", "automation_ready");
CREATE INDEX IF NOT EXISTS "guest_automation_runs_vps_instance_id_createdAt_idx" ON "guest_automation_runs"("vps_instance_id", "createdAt");
CREATE INDEX IF NOT EXISTS "guest_automation_runs_status_createdAt_idx" ON "guest_automation_runs"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "guest_operation_runs_run_id_idx" ON "guest_operation_runs"("run_id");
CREATE INDEX IF NOT EXISTS "guest_operation_runs_vps_instance_id_operation_createdAt_idx" ON "guest_operation_runs"("vps_instance_id", "operation", "createdAt");
CREATE INDEX IF NOT EXISTS "guest_operation_runs_status_createdAt_idx" ON "guest_operation_runs"("status", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "node_guest_capabilities_node_id_key" ON "node_guest_capabilities"("node_id");
CREATE INDEX IF NOT EXISTS "guest_disk_samples_vps_instance_id_recorded_at_idx" ON "guest_disk_samples"("vps_instance_id", "recorded_at");
CREATE INDEX IF NOT EXISTS "guest_disk_samples_vps_instance_id_filesystem_recorded_at_idx" ON "guest_disk_samples"("vps_instance_id", "filesystem", "recorded_at");
CREATE INDEX IF NOT EXISTS "guest_disk_samples_recorded_at_idx" ON "guest_disk_samples"("recorded_at");

-- AddForeignKey (guarded: re-running this migration must not fail)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guest_os_templates_os_template_id_fkey') THEN
    ALTER TABLE "guest_os_templates" ADD CONSTRAINT "guest_os_templates_os_template_id_fkey" FOREIGN KEY ("os_template_id") REFERENCES "os_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guest_operation_templates_template_id_fkey') THEN
    ALTER TABLE "guest_operation_templates" ADD CONSTRAINT "guest_operation_templates_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "guest_os_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vm_guest_adoptions_vps_instance_id_fkey') THEN
    ALTER TABLE "vm_guest_adoptions" ADD CONSTRAINT "vm_guest_adoptions_vps_instance_id_fkey" FOREIGN KEY ("vps_instance_id") REFERENCES "vps_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vm_guest_adoptions_os_template_id_fkey') THEN
    ALTER TABLE "vm_guest_adoptions" ADD CONSTRAINT "vm_guest_adoptions_os_template_id_fkey" FOREIGN KEY ("os_template_id") REFERENCES "os_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vm_guest_adoptions_guest_template_id_fkey') THEN
    ALTER TABLE "vm_guest_adoptions" ADD CONSTRAINT "vm_guest_adoptions_guest_template_id_fkey" FOREIGN KEY ("guest_template_id") REFERENCES "guest_os_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guest_automation_runs_vps_instance_id_fkey') THEN
    ALTER TABLE "guest_automation_runs" ADD CONSTRAINT "guest_automation_runs_vps_instance_id_fkey" FOREIGN KEY ("vps_instance_id") REFERENCES "vps_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guest_operation_runs_run_id_fkey') THEN
    ALTER TABLE "guest_operation_runs" ADD CONSTRAINT "guest_operation_runs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "guest_automation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guest_operation_runs_vps_instance_id_fkey') THEN
    ALTER TABLE "guest_operation_runs" ADD CONSTRAINT "guest_operation_runs_vps_instance_id_fkey" FOREIGN KEY ("vps_instance_id") REFERENCES "vps_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'node_guest_capabilities_node_id_fkey') THEN
    ALTER TABLE "node_guest_capabilities" ADD CONSTRAINT "node_guest_capabilities_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "proxmox_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guest_disk_samples_vps_instance_id_fkey') THEN
    ALTER TABLE "guest_disk_samples" ADD CONSTRAINT "guest_disk_samples_vps_instance_id_fkey" FOREIGN KEY ("vps_instance_id") REFERENCES "vps_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
