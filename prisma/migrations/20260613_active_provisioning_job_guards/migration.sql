CREATE UNIQUE INDEX IF NOT EXISTS provisioning_jobs_active_order_type_uidx
ON provisioning_jobs ("orderId", type)
WHERE "orderId" IS NOT NULL
  AND type IN ('provision', 'reinstall')
  AND status IN ('queued', 'running', 'retrying', 'waiting_for_admin');

CREATE UNIQUE INDEX IF NOT EXISTS provisioning_jobs_active_service_type_uidx
ON provisioning_jobs ("vpsInstanceId", type)
WHERE "vpsInstanceId" IS NOT NULL
  AND type IN ('provision', 'reinstall')
  AND status IN ('queued', 'running', 'retrying', 'waiting_for_admin');
