# Memory

## Current Production Shape

- The application runs from `/var/www/myrdphub`.
- Docker Compose owns the app, worker, scheduler, backup, Redis, Nginx, and optional Postgres services.
- WhatsApp is Evolution API only; local browser/session based WhatsApp runtime is obsolete.

## Evolution API

- Canonical webhook path: `/api/whatsapp/webhook`.
- Temporary compatibility alias: `/api/webhooks/evolution`.
- Required settings: server URL, global API key, instance ID, instance token.
- Instance token is used as incoming webhook authentication.
- Supported webhook events include incoming messages, outgoing messages, message updates, connection updates, and QR updates.

## Database

- Prisma schema and migrations define the database contract.
- Runtime integration config stores provider settings and encrypted secrets.
- WhatsApp logs and CRM tables capture queued, accepted, delivered, read, inbound, outbound, connection, and QR events.

## Backups

- Backup architecture is based on scheduled artifacts, artifact detection, and merge restore.
- Restore operations must avoid destructive table replacement and keep rollback metadata.
- Backup-related local work may exist in the worktree; do not stage it into unrelated fixes.

## Migrations

- Use `docker compose run --rm migrate` for deployed schema changes.
- Repair scripts should tolerate partially migrated data and write current field names.
- Preserve compatibility reads for historical rows only when needed for production migration safety.
