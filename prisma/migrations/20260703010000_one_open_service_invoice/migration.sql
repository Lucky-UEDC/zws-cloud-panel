-- Preserve historical invoices while allowing only one current payable
-- invoice for a VPS service. Existing conflicts must be repaired first.
DO $$
DECLARE conflicts TEXT;
BEGIN
  SELECT string_agg(service_id || ':' || count::text, ', ' ORDER BY service_id)
  INTO conflicts
  FROM (
    SELECT metadata->>'vpsInstanceId' AS service_id, count(*) AS count
    FROM invoices
    WHERE "deletedAt" IS NULL
      AND status IN ('draft','sent','pending','overdue')
      AND coalesce(metadata->>'vpsInstanceId','') <> ''
    GROUP BY metadata->>'vpsInstanceId'
    HAVING count(*) > 1
  ) duplicate_open;
  IF conflicts IS NOT NULL THEN
    RAISE EXCEPTION 'Duplicate open service invoices must be reconciled before migration: %', conflicts;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "invoices_one_open_vps_service_key"
  ON "invoices" ((metadata->>'vpsInstanceId'))
  WHERE "deletedAt" IS NULL
    AND status IN ('draft','sent','pending','overdue')
    AND coalesce(metadata->>'vpsInstanceId','') <> '';
