CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS "roles" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "is_system" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "roles_slug_key" ON "roles"("slug");

CREATE TABLE IF NOT EXISTS "permissions" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "description" TEXT,
  CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "permissions_key_key" ON "permissions"("key");
CREATE INDEX IF NOT EXISTS "permissions_module_idx" ON "permissions"("module");

CREATE TABLE IF NOT EXISTS "role_permissions" (
  "role_id" TEXT NOT NULL,
  "permission_id" TEXT NOT NULL,
  CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id", "permission_id"),
  CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

ALTER TABLE "admin_profiles" ADD COLUMN IF NOT EXISTS "role_id" TEXT;
CREATE INDEX IF NOT EXISTS "admin_profiles_role_id_idx" ON "admin_profiles"("role_id");

ALTER TABLE "admin_profiles"
  ADD CONSTRAINT "admin_profiles_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "key", "module", "description") VALUES
  (gen_random_uuid()::text, 'users.view', 'users', 'View customer accounts'),
  (gen_random_uuid()::text, 'users.edit', 'users', 'Edit customer accounts'),
  (gen_random_uuid()::text, 'users.delete', 'users', 'Delete customer accounts'),
  (gen_random_uuid()::text, 'tickets.view', 'tickets', 'View support tickets'),
  (gen_random_uuid()::text, 'tickets.reply', 'tickets', 'Reply to support tickets'),
  (gen_random_uuid()::text, 'tickets.close', 'tickets', 'Close support tickets'),
  (gen_random_uuid()::text, 'blog.create', 'blog', 'Create blog content'),
  (gen_random_uuid()::text, 'blog.edit', 'blog', 'Edit blog content'),
  (gen_random_uuid()::text, 'blog.publish', 'blog', 'Publish blog content'),
  (gen_random_uuid()::text, 'media.upload', 'blog', 'Upload media assets'),
  (gen_random_uuid()::text, 'seo.manage', 'blog', 'Manage SEO content'),
  (gen_random_uuid()::text, 'billing.view', 'billing', 'View invoices, payments, and transactions'),
  (gen_random_uuid()::text, 'billing.refund', 'billing', 'Issue refunds'),
  (gen_random_uuid()::text, 'billing.manage', 'billing', 'Manage billing operations'),
  (gen_random_uuid()::text, 'services.suspend', 'services', 'Suspend and unlock services'),
  (gen_random_uuid()::text, 'settings.manage', 'settings', 'Manage platform settings'),
  (gen_random_uuid()::text, 'payments.manage', 'settings', 'Manage payment configuration'),
  (gen_random_uuid()::text, 'admins.manage', 'admins', 'Manage admin and staff accounts'),
  (gen_random_uuid()::text, 'roles.manage', 'admins', 'Manage roles and permissions'),
  (gen_random_uuid()::text, 'audit.view', 'admins', 'View audit logs'),
  (gen_random_uuid()::text, 'audit.delete', 'admins', 'Delete audit logs'),
  (gen_random_uuid()::text, 'infrastructure.manage', 'infrastructure', 'Manage nodes, deployments, hypervisors, and monitoring'),
  (gen_random_uuid()::text, 'catalog.manage', 'catalog', 'Manage products, offers, and catalog data')
ON CONFLICT ("key") DO UPDATE SET
  "module" = EXCLUDED."module",
  "description" = EXCLUDED."description";

INSERT INTO "roles" ("id", "name", "slug", "description", "is_system") VALUES
  (gen_random_uuid()::text, 'Super Admin', 'super_admin', 'Full platform access.', true),
  (gen_random_uuid()::text, 'Admin', 'admin', 'Platform management except critical system controls.', true),
  (gen_random_uuid()::text, 'Support Agent', 'support_agent', 'Tickets, clients, invoice viewing, and service suspend/unlock operations.', true),
  (gen_random_uuid()::text, 'Blog Writer', 'blog_writer', 'Blog, media, and SEO content management.', true),
  (gen_random_uuid()::text, 'Billing Manager', 'billing_manager', 'Invoices, payments, refunds, and transactions.', true),
  (gen_random_uuid()::text, 'Infrastructure Manager', 'infrastructure_manager', 'VPS nodes, deployments, hypervisors, and monitoring.', true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "is_system" = EXCLUDED."is_system",
  "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."slug" = 'super_admin'
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."key" IN (
  'users.view', 'users.edit', 'tickets.view', 'tickets.reply', 'tickets.close',
  'blog.create', 'blog.edit', 'blog.publish', 'media.upload', 'seo.manage',
  'billing.view', 'billing.manage', 'services.suspend', 'settings.manage',
  'payments.manage', 'admins.manage', 'roles.manage', 'audit.view',
  'infrastructure.manage', 'catalog.manage'
)
WHERE r."slug" = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."key" IN ('users.view', 'users.edit', 'tickets.view', 'tickets.reply', 'tickets.close', 'billing.view', 'services.suspend', 'audit.view')
WHERE r."slug" = 'support_agent'
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."key" IN ('blog.create', 'blog.edit', 'blog.publish', 'media.upload', 'seo.manage')
WHERE r."slug" = 'blog_writer'
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."key" IN ('billing.view', 'billing.refund', 'billing.manage', 'audit.view')
WHERE r."slug" = 'billing_manager'
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."key" IN ('infrastructure.manage', 'services.suspend', 'audit.view')
WHERE r."slug" = 'infrastructure_manager'
ON CONFLICT DO NOTHING;

UPDATE "admin_profiles" a
SET "role_id" = r."id"
FROM "roles" r
WHERE a."role_id" IS NULL
  AND r."slug" = CASE WHEN a."role" = 'seo_agent' THEN 'blog_writer' ELSE a."role" END;
