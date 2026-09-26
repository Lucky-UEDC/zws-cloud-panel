-- Server Tag (customer-managed friendly identity). Additive only.
-- The system-managed `hostname` / `name` / `instance_name` columns are untouched.

ALTER TABLE "vps_instances" ADD COLUMN "display_tag" TEXT;

-- Backfill existing rows from the friendly service name, but only when it is not
-- an internal/generated identifier (zws.*, vps-*, ip-*, vm-*). Internal names
-- stay NULL so customer UI falls back to the canonical ip-A-B-C-D hostname.
UPDATE "vps_instances"
SET "display_tag" = NULLIF(BTRIM("instance_name"), '')
WHERE "display_tag" IS NULL
  AND "instance_name" IS NOT NULL
  AND BTRIM("instance_name") NOT SIMILAR TO '(zws\.|vps-|ip-%|vm-)%';