-- Normalize WhatsApp campaign provider defaults after retiring the browser runtime.
UPDATE "whatsapp_campaigns"
SET "provider" = 'evolution'
WHERE "provider" = 'whatsapp_web';

ALTER TABLE "whatsapp_campaigns"
ALTER COLUMN "provider" SET DEFAULT 'evolution';
