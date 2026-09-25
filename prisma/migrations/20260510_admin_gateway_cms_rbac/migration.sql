-- RBAC expansion: keep existing owners fully privileged.
UPDATE "admin_profiles"
SET "role" = 'super_admin'
WHERE lower("role") = 'admin';

-- Admin-facing gateway architecture with compatibility migration from domain gateway configs.
CREATE TABLE IF NOT EXISTS "payment_gateways" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "primary" BOOLEAN NOT NULL DEFAULT false,
  "credentials" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_gateways_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "payment_gateways_provider_environment_key" ON "payment_gateways"("provider", "environment");
CREATE INDEX IF NOT EXISTS "payment_gateways_active_primary_idx" ON "payment_gateways"("active", "primary");
CREATE INDEX IF NOT EXISTS "payment_gateways_provider_active_idx" ON "payment_gateways"("provider", "active");

INSERT INTO "payment_gateways" ("id", "name", "provider", "environment", "active", "primary", "credentials", "createdAt", "updatedAt")
SELECT
  'pgw_' || md5("gateway" || ':' || "environment"),
  COALESCE(NULLIF("displayName", ''), initcap("gateway")),
  lower("gateway"),
  COALESCE(NULLIF("environment", ''), 'production'),
  "enabled",
  false,
  jsonb_build_object(
    'migratedFromDomainGatewayId', "id",
    'credentialsEnc', "credentialsEnc",
    'credentialsIv', "credentialsIv",
    'credentialsTag', "credentialsTag",
    'approvedPaymentDomain', "approvedPaymentDomain",
    'webhookUrl', "webhookUrl",
    'returnUrl', "returnUrl",
    'startUrl', "startUrl",
    'extraConfig', "extraConfig"
  ),
  "createdAt",
  "updatedAt"
FROM "domain_gateway_configs"
WHERE "enabled" = true
ON CONFLICT ("provider", "environment") DO NOTHING;

UPDATE "payment_gateways"
SET "primary" = true
WHERE "id" = (
  SELECT "id" FROM "payment_gateways"
  WHERE "active" = true
  ORDER BY
    CASE WHEN "provider" = (SELECT lower("defaultGateway") FROM "domain_configs" WHERE "isPrimary" = true LIMIT 1) THEN 0 ELSE 1 END,
    "createdAt" ASC
  LIMIT 1
);

CREATE TABLE IF NOT EXISTS "cms_categories" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "seoTitle" TEXT,
  "seoDescription" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cms_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "cms_categories_slug_key" ON "cms_categories"("slug");
CREATE INDEX IF NOT EXISTS "cms_categories_slug_idx" ON "cms_categories"("slug");

CREATE TABLE IF NOT EXISTS "cms_tags" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "seoTitle" TEXT,
  "seoDescription" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cms_tags_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "cms_tags_slug_key" ON "cms_tags"("slug");
CREATE INDEX IF NOT EXISTS "cms_tags_slug_idx" ON "cms_tags"("slug");

CREATE TABLE IF NOT EXISTS "cms_media_assets" (
  "id" TEXT NOT NULL,
  "mediaType" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "optimizedName" TEXT,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "storageProvider" TEXT NOT NULL DEFAULT 'local',
  "storagePath" TEXT NOT NULL,
  "publicUrl" TEXT,
  "thumbnailPath" TEXT,
  "altText" TEXT,
  "uploadedBy" TEXT,
  "checksum" TEXT,
  "optimization" JSONB NOT NULL DEFAULT '{}',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cms_media_assets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "cms_media_assets_mediaType_createdAt_idx" ON "cms_media_assets"("mediaType", "createdAt");
CREATE INDEX IF NOT EXISTS "cms_media_assets_uploadedBy_createdAt_idx" ON "cms_media_assets"("uploadedBy", "createdAt");
CREATE INDEX IF NOT EXISTS "cms_media_assets_deletedAt_idx" ON "cms_media_assets"("deletedAt");

CREATE TABLE IF NOT EXISTS "blog_posts" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "excerpt" TEXT,
  "contentJson" JSONB NOT NULL DEFAULT '{}',
  "contentHtml" TEXT NOT NULL DEFAULT '',
  "markdown" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'draft',
  "scheduledAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "featuredImageId" TEXT,
  "categoryId" TEXT,
  "authorId" TEXT,
  "authorEmail" TEXT,
  "seoTitle" TEXT,
  "seoDescription" TEXT,
  "ogImageId" TEXT,
  "canonicalUrl" TEXT,
  "robots" TEXT NOT NULL DEFAULT 'index, follow',
  "schemaJson" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "blog_posts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "blog_posts_slug_key" ON "blog_posts"("slug");
CREATE INDEX IF NOT EXISTS "blog_posts_status_publishedAt_idx" ON "blog_posts"("status", "publishedAt");
CREATE INDEX IF NOT EXISTS "blog_posts_scheduledAt_idx" ON "blog_posts"("scheduledAt");
CREATE INDEX IF NOT EXISTS "blog_posts_categoryId_idx" ON "blog_posts"("categoryId");

CREATE TABLE IF NOT EXISTS "blog_post_tags" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "tagId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "blog_post_tags_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "blog_post_tags_postId_tagId_key" ON "blog_post_tags"("postId", "tagId");
CREATE INDEX IF NOT EXISTS "blog_post_tags_tagId_idx" ON "blog_post_tags"("tagId");

CREATE TABLE IF NOT EXISTS "seo_pages" (
  "id" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "title" TEXT,
  "description" TEXT,
  "ogImage" TEXT,
  "canonicalUrl" TEXT,
  "robots" TEXT NOT NULL DEFAULT 'index, follow',
  "schemaJson" JSONB NOT NULL DEFAULT '{}',
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "seo_pages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "seo_pages_path_key" ON "seo_pages"("path");
CREATE INDEX IF NOT EXISTS "seo_pages_path_idx" ON "seo_pages"("path");

DO $$ BEGIN
  ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "cms_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_featuredImageId_fkey" FOREIGN KEY ("featuredImageId") REFERENCES "cms_media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_ogImageId_fkey" FOREIGN KEY ("ogImageId") REFERENCES "cms_media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "blog_post_tags" ADD CONSTRAINT "blog_post_tags_postId_fkey" FOREIGN KEY ("postId") REFERENCES "blog_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "blog_post_tags" ADD CONSTRAINT "blog_post_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "cms_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
