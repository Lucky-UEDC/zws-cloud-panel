ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "archived" BOOLEAN NOT NULL DEFAULT false;

UPDATE "products"
SET "archived" = true
WHERE lower(coalesce("status", '')) = 'archived'
  OR "isActive" = false;

CREATE INDEX IF NOT EXISTS "products_archived_idx"
  ON "products"("archived");
