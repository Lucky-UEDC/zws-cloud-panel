-- Enterprise WhatsApp engagement platform.
-- Additive migration: preserves legacy campaign/log rows while adding media,
-- templates, recipients, communities, invite automation, and risk controls.

ALTER TABLE "whatsapp_campaigns"
  ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'whatsapp_web',
  ADD COLUMN IF NOT EXISTS "templateId" TEXT,
  ADD COLUMN IF NOT EXISTS "templateVersionId" TEXT,
  ADD COLUMN IF NOT EXISTS "templateLanguage" TEXT,
  ADD COLUMN IF NOT EXISTS "recurrence" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "timezone" TEXT NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS "pacingPolicy" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "compliance" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "riskScore" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "qualityScore" INTEGER NOT NULL DEFAULT 100;

CREATE INDEX IF NOT EXISTS "whatsapp_campaigns_type_status_idx" ON "whatsapp_campaigns"("type", "status");
CREATE INDEX IF NOT EXISTS "whatsapp_campaigns_provider_status_idx" ON "whatsapp_campaigns"("provider", "status");
CREATE INDEX IF NOT EXISTS "whatsapp_campaigns_templateId_idx" ON "whatsapp_campaigns"("templateId");

CREATE TABLE IF NOT EXISTS "whatsapp_media_assets" (
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
  "uploadedBy" TEXT,
  "checksum" TEXT,
  "optimization" JSONB NOT NULL DEFAULT '{}',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_media_assets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "whatsapp_media_assets_mediaType_createdAt_idx" ON "whatsapp_media_assets"("mediaType", "createdAt");
CREATE INDEX IF NOT EXISTS "whatsapp_media_assets_storageProvider_idx" ON "whatsapp_media_assets"("storageProvider");
CREATE INDEX IF NOT EXISTS "whatsapp_media_assets_uploadedBy_createdAt_idx" ON "whatsapp_media_assets"("uploadedBy", "createdAt");
CREATE INDEX IF NOT EXISTS "whatsapp_media_assets_deletedAt_idx" ON "whatsapp_media_assets"("deletedAt");

CREATE TABLE IF NOT EXISTS "whatsapp_campaign_messages" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "stepOrder" INTEGER NOT NULL DEFAULT 1,
  "messageType" TEXT NOT NULL DEFAULT 'text',
  "templateId" TEXT,
  "templateVersionId" TEXT,
  "templateLanguage" TEXT,
  "headerType" TEXT NOT NULL DEFAULT 'none',
  "body" TEXT NOT NULL,
  "caption" TEXT,
  "footer" TEXT,
  "buttons" JSONB NOT NULL DEFAULT '[]',
  "variables" JSONB NOT NULL DEFAULT '[]',
  "mediaAssetId" TEXT,
  "delayMinutes" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_campaign_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "whatsapp_campaign_messages_campaignId_stepOrder_idx" ON "whatsapp_campaign_messages"("campaignId", "stepOrder");
CREATE INDEX IF NOT EXISTS "whatsapp_campaign_messages_templateId_idx" ON "whatsapp_campaign_messages"("templateId");
CREATE INDEX IF NOT EXISTS "whatsapp_campaign_messages_mediaAssetId_idx" ON "whatsapp_campaign_messages"("mediaAssetId");

CREATE TABLE IF NOT EXISTS "whatsapp_campaign_recipients" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "campaignMessageId" TEXT,
  "customerId" TEXT,
  "phoneHash" TEXT,
  "toMasked" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "suppressionReason" TEXT,
  "riskScore" INTEGER NOT NULL DEFAULT 0,
  "frequencyCount" INTEGER NOT NULL DEFAULT 0,
  "variables" JSONB NOT NULL DEFAULT '{}',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "queuedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "readAt" TIMESTAMP(3),
  "clickedAt" TIMESTAMP(3),
  "convertedAt" TIMESTAMP(3),
  "unsubscribedAt" TIMESTAMP(3),
  "joinedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_campaign_recipients_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "whatsapp_campaign_recipients_campaignId_status_idx" ON "whatsapp_campaign_recipients"("campaignId", "status");
CREATE INDEX IF NOT EXISTS "whatsapp_campaign_recipients_campaignMessageId_status_idx" ON "whatsapp_campaign_recipients"("campaignMessageId", "status");
CREATE INDEX IF NOT EXISTS "whatsapp_campaign_recipients_customerId_createdAt_idx" ON "whatsapp_campaign_recipients"("customerId", "createdAt");
CREATE INDEX IF NOT EXISTS "whatsapp_campaign_recipients_phoneHash_createdAt_idx" ON "whatsapp_campaign_recipients"("phoneHash", "createdAt");

CREATE TABLE IF NOT EXISTS "whatsapp_campaign_media" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "campaignMessageId" TEXT,
  "mediaAssetId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'header',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_campaign_media_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_campaign_media_campaignId_campaignMessageId_mediaAssetId_role_key" ON "whatsapp_campaign_media"("campaignId", "campaignMessageId", "mediaAssetId", "role");
CREATE INDEX IF NOT EXISTS "whatsapp_campaign_media_campaignId_idx" ON "whatsapp_campaign_media"("campaignId");
CREATE INDEX IF NOT EXISTS "whatsapp_campaign_media_mediaAssetId_idx" ON "whatsapp_campaign_media"("mediaAssetId");

CREATE TABLE IF NOT EXISTS "whatsapp_campaign_events" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT,
  "campaignMessageId" TEXT,
  "recipientId" TEXT,
  "customerId" TEXT,
  "mediaAssetId" TEXT,
  "eventType" TEXT NOT NULL,
  "status" TEXT,
  "provider" TEXT,
  "messageLogId" TEXT,
  "campaignLogId" TEXT,
  "phoneHash" TEXT,
  "maskedPhone" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_campaign_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "whatsapp_campaign_events_campaignId_eventType_createdAt_idx" ON "whatsapp_campaign_events"("campaignId", "eventType", "createdAt");
CREATE INDEX IF NOT EXISTS "whatsapp_campaign_events_recipientId_createdAt_idx" ON "whatsapp_campaign_events"("recipientId", "createdAt");
CREATE INDEX IF NOT EXISTS "whatsapp_campaign_events_customerId_createdAt_idx" ON "whatsapp_campaign_events"("customerId", "createdAt");
CREATE INDEX IF NOT EXISTS "whatsapp_campaign_events_mediaAssetId_eventType_createdAt_idx" ON "whatsapp_campaign_events"("mediaAssetId", "eventType", "createdAt");

CREATE TABLE IF NOT EXISTS "whatsapp_campaign_groups" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "communityId" TEXT,
  "groupId" TEXT,
  "inviteId" TEXT,
  "role" TEXT NOT NULL DEFAULT 'target',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_campaign_groups_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "whatsapp_campaign_groups_campaignId_idx" ON "whatsapp_campaign_groups"("campaignId");
CREATE INDEX IF NOT EXISTS "whatsapp_campaign_groups_communityId_idx" ON "whatsapp_campaign_groups"("communityId");
CREATE INDEX IF NOT EXISTS "whatsapp_campaign_groups_groupId_idx" ON "whatsapp_campaign_groups"("groupId");

CREATE TABLE IF NOT EXISTS "whatsapp_campaign_templates" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "templateVersionId" TEXT,
  "language" TEXT NOT NULL DEFAULT 'en',
  "role" TEXT NOT NULL DEFAULT 'primary',
  "variables" JSONB NOT NULL DEFAULT '{}',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_campaign_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "whatsapp_campaign_templates_campaignId_idx" ON "whatsapp_campaign_templates"("campaignId");
CREATE INDEX IF NOT EXISTS "whatsapp_campaign_templates_templateId_idx" ON "whatsapp_campaign_templates"("templateId");

CREATE TABLE IF NOT EXISTS "whatsapp_communities" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "category" TEXT NOT NULL DEFAULT 'customer',
  "language" TEXT,
  "country" TEXT,
  "region" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_communities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_communities_slug_key" ON "whatsapp_communities"("slug");
CREATE INDEX IF NOT EXISTS "whatsapp_communities_status_category_idx" ON "whatsapp_communities"("status", "category");
CREATE INDEX IF NOT EXISTS "whatsapp_communities_country_language_idx" ON "whatsapp_communities"("country", "language");

CREATE TABLE IF NOT EXISTS "whatsapp_groups" (
  "id" TEXT NOT NULL,
  "communityId" TEXT,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "category" TEXT NOT NULL DEFAULT 'customer',
  "language" TEXT,
  "country" TEXT,
  "region" TEXT,
  "service" TEXT,
  "plan" TEXT,
  "product" TEXT,
  "inviteLink" TEXT,
  "approvalMode" TEXT NOT NULL DEFAULT 'optional',
  "status" TEXT NOT NULL DEFAULT 'active',
  "memberCount" INTEGER NOT NULL DEFAULT 0,
  "joinCount" INTEGER NOT NULL DEFAULT 0,
  "pendingApprovals" INTEGER NOT NULL DEFAULT 0,
  "messageVolume" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_groups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_groups_slug_key" ON "whatsapp_groups"("slug");
CREATE INDEX IF NOT EXISTS "whatsapp_groups_communityId_status_idx" ON "whatsapp_groups"("communityId", "status");
CREATE INDEX IF NOT EXISTS "whatsapp_groups_category_status_idx" ON "whatsapp_groups"("category", "status");
CREATE INDEX IF NOT EXISTS "whatsapp_groups_country_language_idx" ON "whatsapp_groups"("country", "language");

CREATE TABLE IF NOT EXISTS "whatsapp_group_members" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "customerId" TEXT,
  "phoneHash" TEXT,
  "toMasked" TEXT,
  "status" TEXT NOT NULL DEFAULT 'invited',
  "role" TEXT NOT NULL DEFAULT 'member',
  "source" TEXT,
  "invitedAt" TIMESTAMP(3),
  "joinedAt" TIMESTAMP(3),
  "leftAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_group_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_group_members_groupId_customerId_key" ON "whatsapp_group_members"("groupId", "customerId");
CREATE INDEX IF NOT EXISTS "whatsapp_group_members_groupId_status_idx" ON "whatsapp_group_members"("groupId", "status");
CREATE INDEX IF NOT EXISTS "whatsapp_group_members_customerId_createdAt_idx" ON "whatsapp_group_members"("customerId", "createdAt");
CREATE INDEX IF NOT EXISTS "whatsapp_group_members_phoneHash_createdAt_idx" ON "whatsapp_group_members"("phoneHash", "createdAt");

CREATE TABLE IF NOT EXISTS "whatsapp_group_invites" (
  "id" TEXT NOT NULL,
  "communityId" TEXT,
  "groupId" TEXT NOT NULL,
  "campaignId" TEXT,
  "customerId" TEXT,
  "inviteLink" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "approvalMode" TEXT NOT NULL DEFAULT 'optional',
  "usageLimit" INTEGER,
  "usageCount" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3),
  "generatedBy" TEXT,
  "disabledAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_group_invites_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "whatsapp_group_invites_groupId_status_idx" ON "whatsapp_group_invites"("groupId", "status");
CREATE INDEX IF NOT EXISTS "whatsapp_group_invites_campaignId_idx" ON "whatsapp_group_invites"("campaignId");
CREATE INDEX IF NOT EXISTS "whatsapp_group_invites_customerId_createdAt_idx" ON "whatsapp_group_invites"("customerId", "createdAt");
CREATE INDEX IF NOT EXISTS "whatsapp_group_invites_expiresAt_idx" ON "whatsapp_group_invites"("expiresAt");

CREATE TABLE IF NOT EXISTS "whatsapp_group_routing_rules" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "communityId" TEXT,
  "groupId" TEXT,
  "conditions" JSONB NOT NULL DEFAULT '{}',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_group_routing_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "whatsapp_group_routing_rules_enabled_priority_idx" ON "whatsapp_group_routing_rules"("enabled", "priority");
CREATE INDEX IF NOT EXISTS "whatsapp_group_routing_rules_communityId_idx" ON "whatsapp_group_routing_rules"("communityId");
CREATE INDEX IF NOT EXISTS "whatsapp_group_routing_rules_groupId_idx" ON "whatsapp_group_routing_rules"("groupId");

CREATE TABLE IF NOT EXISTS "whatsapp_broadcast_audiences" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "filter" JSONB NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_broadcast_audiences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_broadcast_audiences_slug_key" ON "whatsapp_broadcast_audiences"("slug");
CREATE INDEX IF NOT EXISTS "whatsapp_broadcast_audiences_status_idx" ON "whatsapp_broadcast_audiences"("status");

CREATE TABLE IF NOT EXISTS "whatsapp_suppressions" (
  "id" TEXT NOT NULL,
  "customerId" TEXT,
  "phoneHash" TEXT,
  "reason" TEXT NOT NULL,
  "source" TEXT,
  "scope" TEXT NOT NULL DEFAULT 'marketing',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "expiresAt" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_suppressions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "whatsapp_suppressions_customerId_active_idx" ON "whatsapp_suppressions"("customerId", "active");
CREATE INDEX IF NOT EXISTS "whatsapp_suppressions_phoneHash_active_idx" ON "whatsapp_suppressions"("phoneHash", "active");
CREATE INDEX IF NOT EXISTS "whatsapp_suppressions_scope_active_idx" ON "whatsapp_suppressions"("scope", "active");

CREATE TABLE IF NOT EXISTS "whatsapp_risk_rules" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "severity" TEXT NOT NULL DEFAULT 'medium',
  "ruleType" TEXT NOT NULL,
  "threshold" INTEGER NOT NULL DEFAULT 0,
  "action" TEXT NOT NULL DEFAULT 'slow_down',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_risk_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "whatsapp_risk_rules_enabled_ruleType_idx" ON "whatsapp_risk_rules"("enabled", "ruleType");

CREATE TABLE IF NOT EXISTS "whatsapp_automation_flows" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "trigger" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "steps" JSONB NOT NULL DEFAULT '[]',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_automation_flows_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_automation_flows_slug_key" ON "whatsapp_automation_flows"("slug");
CREATE INDEX IF NOT EXISTS "whatsapp_automation_flows_trigger_status_idx" ON "whatsapp_automation_flows"("trigger", "status");

CREATE TABLE IF NOT EXISTS "whatsapp_automation_flow_runs" (
  "id" TEXT NOT NULL,
  "flowId" TEXT NOT NULL,
  "customerId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "currentStep" INTEGER NOT NULL DEFAULT 0,
  "context" JSONB NOT NULL DEFAULT '{}',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_automation_flow_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "whatsapp_automation_flow_runs_flowId_status_idx" ON "whatsapp_automation_flow_runs"("flowId", "status");
CREATE INDEX IF NOT EXISTS "whatsapp_automation_flow_runs_customerId_createdAt_idx" ON "whatsapp_automation_flow_runs"("customerId", "createdAt");
