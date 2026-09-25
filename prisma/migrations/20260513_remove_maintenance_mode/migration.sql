UPDATE "admin_settings"
SET "value" = ((((("value"::jsonb - 'maintenanceMode') - 'maintenanceEnabled') - 'maintenanceMessage') - 'maintenanceStartedAt') - 'maintenanceEta')
WHERE "key" = 'platform_settings';
