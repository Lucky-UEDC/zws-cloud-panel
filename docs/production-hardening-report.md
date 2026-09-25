# Production Hardening Report

Generated: 2026-06-17

## Executive Status

- Database Health: PASS
- Admin Pages: BLOCKED for authenticated page render proof; unauthenticated route protection verified
- Client VPS Page: BLOCKED for authenticated VM-list render proof; unauthenticated route protection verified
- WhatsApp Delivery: PASS
- Password Reset WhatsApp: PASS by static/regression coverage
- Realtime Proxmox: PASS
- IP Pool Rewrite: PASS by static/regression coverage and database schema validation
- Delete IP Feature: PASS by static/regression coverage
- Cloudflare Tunnel Support: PARTIAL; artifact/readiness logic verified, Cloudflare API validation blocked by missing credentials
- Security Dashboard: PARTIAL; route exists and is protected, authenticated report render blocked by missing admin session
- Build: PASS
- Tests: PASS
- Pages Verified: PARTIAL; public routes and protected-route behavior verified, authenticated browser smoke blocked

## Code Change Made During Verification

- Fixed `/api/health` degraded mode caused by expected PM2 companion apps being treated as forbidden extras.
- `zws-vnc-proxy` and `zws-proxmox-events` are now allowed PM2 companion services by default while unknown managed extras still degrade health.
- Added a regression test for the PM2 companion-service health behavior.

## Validation Evidence

- `pnpm prisma validate`: PASS.
- `pnpm prisma migrate status`: PASS; 130 migrations found, database schema is up to date.
- `pnpm prisma generate`: PASS; Prisma Client v6.19.3 generated.
- `pnpm db:check`: PASS; no missing tables, columns, indexes, foreign keys, pending migrations, or failed migrations.
- Targeted database reads: PASS; orders 18, customers 7, customer wallet balances 7, wallet transactions 1, VM records 16, nodes 2, templates 15, IP pools 2, invoices 13, tickets 1.
- `pnpm db:validate:migrations`: PASS.
- `pnpm typecheck`: PASS.
- `pnpm lint`: PASS.
- `pnpm test`: PASS; 69 passed, 0 failed.
- `pnpm test:production`: PASS; 16 passed, 0 failed.
- `pnpm build`: PASS; Next build completed, frontend artifact verification passed, chunk smoke passed with 8 CSS chunks and 10132 JS chunks.
- `pnpm audit --prod --audit-level critical`: PASS exit code; residual non-critical audit output reported 1 low and 5 moderate vulnerabilities.

## Live Runtime Evidence

- Rebuilt standalone runtime started on `http://127.0.0.1:3002` with repo env loaded.
- `/api/health`: PASS, returned HTTP 200 with `status: "ok"` after the PM2 companion-service fix.
- `pnpm verify:routes` against `http://127.0.0.1:3002`: PASS; 28 routes checked.
- Public pages `/`, `/pricing`, `/login`, `/register`: PASS, HTTP 200.
- Protected admin/client pages returned expected auth redirects, not crashes: `/admin`, `/admin/vms`, `/admin/orders`, `/admin/backups`, `/admin/compute-nodes`, `/client-area`, `/client-area/vps`, `/client-area/billing`, `/client-area/support`.
- Protected admin APIs returned expected HTTP 401, not crashes: `/api/admin/bandwidth`, `/api/admin/proxmox/vms`, `/api/admin/whatsapp/overview`, `/api/admin/whatsapp/contacts`, `/api/admin/whatsapp/conversations`, `/api/admin/whatsapp/auto-replies`.
- Focused probes for `/admin/compute-nodes`, `/admin/compute-nodes/:id`, `/admin/ip-pools`, `/admin/ip-pools/:id`, `/admin/proxmox`, `/admin/compute-infrastructure`, `/admin/orders`, `/admin/customers`, and `/client-area/vps`: PASS for route protection; all returned HTTP 307 auth redirects without server exceptions.
- `/api/whatsapp/webhook`: PASS, HTTP 200.
- `/api/runtime/config`: PASS, HTTP 200.

## Integration Evidence

- WhatsApp Evolution real-send test: PASS via `pnpm test:whatsapp`; Evolution API 2.3.7 reachable, API key valid, instance connected, send endpoint valid, real send accepted with message ID `3EB0129FB4AC4D8E11AC51`, webhook reachable, webhook configured.
- WhatsApp webhook logs: PASS for inbound processing evidence; recent `MESSAGES_UPSERT` and `CONTACTS_UPDATE` webhook events are stored with `status: "processed"`.
- Proxmox connection validation: PASS; 2 active nodes checked, both returned OK for version, nodes, cluster status/resources, node status, QEMU, and storage API probes.
- Realtime Proxmox event path: PASS; local publish/subscribe on `zws:realtime:proxmox:events` delivered in 1ms against a 250ms target.
- Cloudflare-only readiness against the rebuilt runtime: PASS; health, payments, uploads, payment webhook, WhatsApp webhook, auth, Proxmox, and cron/system-health checks all returned acceptable statuses.
- Cloudflare API tunnel report: BLOCKED; `CF_API_TOKEN`, `CF_ACCOUNT_ID`, `CF_TUNNEL_ID`, and `CF_ZONE_ID` are not exported in this environment.

## Files Changed

- `app/api/health/route.ts`
- `scripts/tests/unit/production-hardening-static.test.ts`
- `docs/production-hardening-report.md`

## Migrations Created

- None during this verification pass.
- Existing recovery migrations verified: `prisma/migrations/20260616_database_registry/` and `prisma/migrations/20260617_canonical_ip_pool_assignments/`.

## Unresolved Or Blocked Items

- Authenticated admin/client browser smoke was blocked because `FRONTEND_VERIFY_COOKIE`, `FRONTEND_VERIFY_EMAIL`, and `FRONTEND_VERIFY_PASSWORD` are unset.
- Cloudflare API tunnel creation/inspection and DNS migration proof were blocked because Cloudflare credentials are unset.
- The direct WhatsApp send script does not create local message/delivery rows for its message ID; external send acceptance and webhook processing were verified separately.
- `pnpm audit --prod --audit-level critical` passed, but pnpm reported 1 low and 5 moderate vulnerabilities that should be triaged separately.
