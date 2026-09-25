-- Remove obsolete WhatsApp Web session/runtime storage now that Evolution API owns connectivity.
-- Historical migration files are left intact for already-deployed database provenance.

DROP TABLE IF EXISTS "whatsapp_runtime_state";
DROP TABLE IF EXISTS "whatsapp_sessions";
DROP TABLE IF EXISTS "whatsapp_session_logs";
