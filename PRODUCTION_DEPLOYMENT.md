# Production Deployment

Production deployments must use:

```bash
pnpm deploy:prod
```

The deploy script builds a candidate release, runs validation, checks candidate health, syncs the validated candidate into `/var/www/myrdphub`, then reloads PM2 with updated environment.

## Runtime URLs

Set these values in the production env file:

```env
APP_URL=https://your-domain.example
NEXT_PUBLIC_APP_URL=https://your-domain.example
SITE_DOMAIN=your-domain.example
```

Payment gateway webhook and callback URLs are generated at runtime from the active request/domain helpers.

## Rollback

`update.sh` rolls back automatically on failed candidate or live health checks by restoring the backed-up `/var/www/myrdphub` tree, then reloading `ecosystem.config.js` with PM2.

## QA

Run the enterprise QA loop:

```bash
pnpm qa:enterprise
```

The command writes `FINAL_QA_REPORT.md`.
