ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "default_node_id" TEXT;

CREATE INDEX IF NOT EXISTS "products_default_node_id_idx" ON "products"("default_node_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_default_node_id_fkey'
  ) THEN
    ALTER TABLE "products"
      ADD CONSTRAINT "products_default_node_id_fkey"
      FOREIGN KEY ("default_node_id") REFERENCES "proxmox_nodes"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
