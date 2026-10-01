-- Let one Proxmox template back several guest profiles.
--
-- The link was declared UNIQUE, which made it impossible to express: a single
-- template named "Windows Latest" backs the 2019, 2022 and 2025 guest profiles,
-- and a single CentOS-8 image backs more than one RHEL-family profile. The seeder
-- hit the constraint on the second Windows profile, and every profile after it was
-- left unlinked — so nothing joined the Proxmox catalogue to the guest profiles
-- and "is there a real test guest for this OS?" was unanswerable.
--
-- Nothing reads the column expecting uniqueness. It is a navigation used to show
-- which template proves a profile, so dropping the constraint is safe and changes
-- no existing row.
--
-- Idempotent: IF EXISTS on the drop, IF NOT EXISTS on the replacement.

DROP INDEX IF EXISTS "guest_os_templates_os_template_id_key";

CREATE INDEX IF NOT EXISTS "guest_os_templates_os_template_id_idx"
  ON "guest_os_templates"("os_template_id");
