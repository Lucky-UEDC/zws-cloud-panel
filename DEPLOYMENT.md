# Deployment

## Zero-Downtime Production Deploy

Production deploys must use the atomic release script. Do not build in the live tree, delete `.next` in place, or stop the web service during an update.

Production deploys also require an app-host snapshot gate because the application VM is not discoverable as a Proxmox guest from inside this host. Configure `ZWS_APP_SNAPSHOT_COMMAND`; the command must create the platform snapshot and exit non-zero on failure.

```bash
cd /var/www/myrdphub
pnpm deploy:prod
```

The script creates a disposable no-Git candidate under `/var/tmp`, builds and tests it, stores rollback data under `/var/backups/myrdphub`, syncs the validated candidate into `/var/www/myrdphub`, gracefully reloads PM2, and removes the candidate.

## Release Layout

```txt
/var/www/myrdphub/
  active codebase
  releases/
  shared/
    .env.production
    .env.staging
    uploads/
  logs/
```

On the first production run, `install.sh` creates `/var/www/myrdphub/shared/.env.production` if the shared env file does not exist. It never overwrites an existing shared env file.

## Required Gates

Production is not switched until these pass in the candidate release:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm db:check
pnpm exec playwright test
curl http://127.0.0.1:3101/api/health
```

To create dedicated credentialed E2E users before Playwright, set these in the shared env and run with `E2E_SEED_USERS=1`:

```bash
ZWS_E2E_ADMIN_EMAIL=...
ZWS_E2E_ADMIN_PASSWORD=...
ZWS_E2E_CUSTOMER_EMAIL=...
ZWS_E2E_CUSTOMER_PASSWORD=...
```

After the symlink switch, the live app must pass:

```bash
curl "http://127.0.0.1:${PORT}/api/health"
```

## PM2 Runtime

Start or persist PM2 with:

```bash
pm2 startOrReload /var/www/myrdphub/ecosystem.config.js --update-env
pm2 save
pm2 startup
```

The visible ZWS PM2 apps are exactly `zws-web`, `zws-whatsapp`, `zws-worker`, and `zws-vnc-proxy`.

Do not run `zws-*` app or worker systemd units, cron jobs, nohup, screen, tmux, forever, or custom background launchers. PM2 owns the web app, WhatsApp worker, background worker supervisor, and console websocket proxy.

## Staging

Staging uses a separate root directory and port:

```bash
cd /var/www/myrdphub
pnpm deploy:staging
```

Expected staging values:

```txt
Hostname: staging.example.com
Env file: /var/www/myrdphub/shared/.env.staging
Staging root: /var/www/myrdphub-staging
Default port: 3002
Candidate port: 3003
PM2 app: zws-cloud-staging
```

Promote the same commit to production only after staging and Playwright checks pass.

## Rollback

If candidate health, PM2 reload, or live health fails, `update.sh` restores the backed-up production tree and reloads PM2. Database migrations are not automatically rolled back unless an explicit database restore is enabled; production migrations must be backward-compatible with the previous release.

Failed releases and logs are intentionally left on disk for investigation. The script keeps the newest five releases and backups by default.

## Cloudflare And Nginx

Cloudflare Tunnel and Nginx should continue forwarding production traffic to:

```txt
http://127.0.0.1:$PORT
```

Staging should forward to:

```txt
http://127.0.0.1:3002
```

Keep Cloudflare cache bypass rules for `/admin/*`, `/api/*`, auth routes, checkout, payment, and session routes.

## One-Time Swap Setup

Run as root on low-memory hosts:

```bash
fallocate -l 8G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
swapon --show
```
