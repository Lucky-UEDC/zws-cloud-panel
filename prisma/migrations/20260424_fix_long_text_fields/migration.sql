ALTER TABLE `audit_logs`
  MODIFY `oldValue` TEXT NULL,
  MODIFY `newValue` TEXT NULL;

ALTER TABLE `analytics_events`
  MODIFY `referrer` TEXT NULL;
