# Production Notes

## Runtime Stack

- Cloudflare proxy and Cloudflare Tunnel are the only public ingress.
- Production forwards to `http://127.0.0.1:$PORT`.
- Staging forwards to its configured local port.
- Next.js production runs under PM2 as `zws-web` from `/var/www/myrdphub`.
- WhatsApp, background work, and console websocket isolation is provided by `zws-whatsapp`, `zws-worker`, and `zws-vnc-proxy`.
- PostgreSQL, Redis, Prisma, payment gateways, and Proxmox provide application services.

## Environment

Production secrets live in:

```txt
/var/www/myrdphub/shared/.env.production
```

Required production values include:

```bash
SITE_DOMAIN=example.com
APP_URL=https://example.com
NEXT_PUBLIC_APP_URL=https://example.com
NEXTAUTH_URL=https://example.com
PORT=3000
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=...
SESSION_SECRET=...
ZWS_E2E_ADMIN_EMAIL=...
ZWS_E2E_ADMIN_PASSWORD=...
ZWS_E2E_CUSTOMER_EMAIL=...
ZWS_E2E_CUSTOMER_PASSWORD=...
```

Staging secrets live in:

```txt
/var/www/myrdphub/shared/.env.staging
```

Use staging-specific DB, Redis namespace/database, and payment test credentials.

## Deploy Sequence

Use only the atomic deploy entrypoint:

```bash
cd /var/www/myrdphub
pnpm deploy:prod
```

Do not stop the live PM2 app or remove `.next` in place. That flow causes Cloudflare 502s because it removes the live build and stops the only web process.

## Health Checks

```bash
curl -fsS "http://127.0.0.1:${PORT}/api/health"
pm2 status
pm2 logs zws-web --lines 200
curl -fsS "http://127.0.0.1:${VNC_PROXY_PORT:-3001}/health"
```

Verbose local diagnostics:

```bash
curl -fsS "http://127.0.0.1:${PORT}/api/health?verbose=1"
```

## PM2 Persistence

```bash
pm2 startOrReload /var/www/myrdphub/ecosystem.config.js --update-env
pm2 save
pm2 startup
```

## Guardrails

- Run staging before production for risky updates.
- Keep payment mode in test on staging.
- Do not provision from pending gateway payments.
- Keep raw webhook verification enabled.
- Do not expose Proxmox, database, session, or payment secrets.
- Write only backward-compatible production migrations; app rollback cannot safely undo DB changes.
