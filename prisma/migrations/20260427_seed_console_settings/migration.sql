INSERT INTO "admin_settings" ("id", "key", "value", "description", "updatedBy", "createdAt", "updatedAt")
VALUES (
  'console_settings',
  'console_settings',
  '{"version":1,"globalConsoleEnabled":true,"linuxTerminalEnabled":true,"graphicalConsoleEnabled":true,"allowSuspendedConsole":false,"updatedBy":"migration"}'::jsonb,
  'Settings for console_settings',
  'migration',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
