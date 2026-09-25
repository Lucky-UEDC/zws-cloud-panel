CREATE TABLE IF NOT EXISTS "support_ticket_attachments" (
  "id" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "customerId" TEXT,
  "adminId" TEXT,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "checksumSha256" TEXT NOT NULL,
  "storageProvider" TEXT NOT NULL DEFAULT 'local',
  "storageKey" TEXT NOT NULL,
  "thumbnailKey" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_ticket_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "support_ticket_attachments_ticketId_createdAt_idx" ON "support_ticket_attachments"("ticketId", "createdAt");
CREATE INDEX IF NOT EXISTS "support_ticket_attachments_messageId_idx" ON "support_ticket_attachments"("messageId");
CREATE INDEX IF NOT EXISTS "support_ticket_attachments_customerId_createdAt_idx" ON "support_ticket_attachments"("customerId", "createdAt");
CREATE INDEX IF NOT EXISTS "support_ticket_attachments_adminId_createdAt_idx" ON "support_ticket_attachments"("adminId", "createdAt");
CREATE INDEX IF NOT EXISTS "support_ticket_attachments_deletedAt_idx" ON "support_ticket_attachments"("deletedAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'support_ticket_attachments_ticketId_fkey'
      AND table_name = 'support_ticket_attachments'
  ) THEN
    ALTER TABLE "support_ticket_attachments"
      ADD CONSTRAINT "support_ticket_attachments_ticketId_fkey"
      FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'support_ticket_attachments_messageId_fkey'
      AND table_name = 'support_ticket_attachments'
  ) THEN
    ALTER TABLE "support_ticket_attachments"
      ADD CONSTRAINT "support_ticket_attachments_messageId_fkey"
      FOREIGN KEY ("messageId") REFERENCES "support_ticket_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'support_ticket_attachments_customerId_fkey'
      AND table_name = 'support_ticket_attachments'
  ) THEN
    ALTER TABLE "support_ticket_attachments"
      ADD CONSTRAINT "support_ticket_attachments_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'support_ticket_attachments_adminId_fkey'
      AND table_name = 'support_ticket_attachments'
  ) THEN
    ALTER TABLE "support_ticket_attachments"
      ADD CONSTRAINT "support_ticket_attachments_adminId_fkey"
      FOREIGN KEY ("adminId") REFERENCES "admin_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
