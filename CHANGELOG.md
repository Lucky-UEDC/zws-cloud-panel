# Changelog

## Unreleased

- Added a modern staged noVNC/xterm.js console experience with live VM status cards, structured failures, responsive controls, and screenshot capture/download.
- Added shared client/admin console overview APIs with five-second telemetry refresh.
- Replaced persistent release-directory deployment with disposable candidate builds and a single `/var/www/myrdphub` production source.
- Added the `myrdphub-platform` repository documentation, architecture diagrams, contribution policy, and proprietary license.

## Enterprise Provisioning Routing - 2026-05-29

- Added centralized node/template compatibility for checkout, admin order creation, provision readiness, auto provision, and reinstall.
- Enforced strict node-scoped OS template visibility with Windows-only and Linux-only filtering in both directions.
- Added admin bulk OS template actions for delete, enable, disable, sync, and move with cache invalidation.
- Centralized admin OS template icons on the shared OS icon resolver.
- Added manual VM delivery and manual IP assignment APIs/page for fully active externally provisioned services.
- Added placement-driven reinstall migration so Windows to Linux and Linux to Windows reinstalls can move nodes safely.
- Added `node_workers` with per-node provision slot accounting, stale recovery, and dynamic task limits.
- Added provisioning settings to the database-backed settings schema and diagnostics for Windows node routing.
- Added official public one-line installer/updater scripts served from `/install.sh` and `/update.sh`.
- Extended installer support to Ubuntu, Debian, AlmaLinux, and RockyLinux with firewall, SSL, Nginx, Redis, PostgreSQL, PM2, Prisma, build, and health checks.

## Enterprise Stabilization - 2026-05-17

- Moved production candidate deploys off the VNC proxy port and added a required app-host snapshot gate before release switch.
- Enforced PM2-only app ownership in installers and QA checks, with a dedicated VM deletion retry worker.
- Standardized expired-session JSON/page behavior and stale auth cookie clearing.
- Added canonical VM deletion jobs, retry states, cleanup auditing, and admin delete/retry APIs.
- Added diagnostics action APIs, deployment snapshot metadata APIs, notification rule APIs, and integration health logs.
- Hardened product creation validation and shared admin dropdown layering/blur styling.
- Added a universal installer with interactive, silent, enterprise, and development modes plus Cloudflare tunnel routing.

## zwscloud-panel-live-v1 - 2026-05-05

- Added shared paid finalization for checkout, wallet, webhook, reconciliation, admin mark-paid, and invoice-paid flows.
- Added checkout intent support so gateway payments stay pending until verified.
- Added wallet top-up flow and wallet idempotency.
- Hardened Cashfree/PhonePe payment start, redirect, webhook, and status handling.
- Added VPS CPU/RAM upgrade flow with order, invoice, wallet/gateway payment, and paid-only provisioning.
- Added disk upgrade support for resize, migration, and additional disks.
- Added shared OS availability helper for checkout, offer, reinstall, and provisioning.
- Improved Windows template/reinstall support and default admin username behavior.
- Added admin revenue reporting and safer bulk invoice/order actions.
- Added invoice cleanup safety helpers.
- Added email module improvements, SMTP diagnostics, and template workflows.
- Updated production docs for private repo `zwscloud-panel-live-v1`.

## Historical Snapshots

- `zwscloud-linex-productin-v1`: previous private full-tree snapshot.
- `zws-prod-v7`: previous production snapshot name retained here only as history.
- `zws-prod-v6` and earlier: legacy release snapshots.
