-- Add the HYBRID node mode in its own migration. PostgreSQL requires the
-- enum value to commit before later migrations can use it in defaults/data.

DO $$
BEGIN
  ALTER TYPE "NodeProvisioningMode" ADD VALUE IF NOT EXISTS 'HYBRID';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
