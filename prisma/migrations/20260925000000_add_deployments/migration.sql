-- Additive: admin Update Center deployment-tracking table.
-- Guarded so it is safe on every environment and never touches existing rows.
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'deployments') THEN
    CREATE TABLE "deployments" (
      "id" TEXT NOT NULL,
      "version" TEXT NOT NULL,
      "commit" TEXT,
      "image" TEXT NOT NULL,
      "digest" TEXT,
      "status" TEXT NOT NULL DEFAULT 'planned',
      "stage" TEXT,
      "stage_output" JSONB,
      "migration_count" INTEGER NOT NULL DEFAULT 0,
      "started_by" TEXT,
      "error" TEXT,
      "started_at" TIMESTAMP(3),
      "completed_at" TIMESTAMP(3),
      "rollback_version" TEXT,
      "metadata" JSONB NOT NULL DEFAULT '{}',
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "deployments_pkey" PRIMARY KEY ("id")
    );
    CREATE INDEX "deployments_status_started_at_idx" ON "deployments"("status", "started_at");
  END IF;
END $do$;