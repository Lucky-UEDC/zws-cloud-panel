-- Multi-disk storage support upgrade
-- Migrates from single storage field to flexible JSON array of disks
-- Baseline (20260808000000_fresh_full_baseline) already created these columns;
-- this migration is idempotent for existing production databases.

ALTER TABLE "custom_configs"
ADD COLUMN IF NOT EXISTS "disks" JSONB NOT NULL DEFAULT '[{"type":"nvme","sizeGb":160,"label":"Disk 1"}]'::jsonb;

ALTER TABLE "products"
ADD COLUMN IF NOT EXISTS "disks" JSONB NOT NULL DEFAULT '[{"type":"nvme","sizeGb":160}]'::jsonb;

-- Backfill products disks from deprecated single-storage columns where present
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'products' AND column_name = 'storageType')
     AND EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'products' AND column_name = 'storageGb') THEN
    UPDATE "products" p
    SET "disks" = jsonb_build_array(jsonb_build_object(
      'type', COALESCE(p."storageType", 'nvme'),
      'sizeGb', COALESCE(p."storageGb", 160)
    ))
    WHERE p."storageType" IS NOT NULL OR p."storageGb" IS NOT NULL;
  END IF;
END $$;