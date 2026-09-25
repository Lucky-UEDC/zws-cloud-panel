# Installation Guide

This guide installs MyRDPHub Platform on Ubuntu, Debian, AlmaLinux, or RockyLinux with one PM2 ecosystem.

Official one-line install:

```bash
curl -fsSL https://myrdphub.com/install.sh | bash
```

## 1. Prepare Server

```bash
sudo apt update
sudo apt install -y git curl build-essential
sudo mkdir -p /var/www
```

Point DNS to the server before SSL setup. Use a private GitHub token, `gh auth login`, or a deploy key to clone the repo.

## 2. Clone Source

```bash
sudo git clone https://github.com/samvpslio/myrdphub-platform.git /var/www/myrdphub
cd /var/www/myrdphub
```

## 3. Run Installer

```bash
sudo bash install.sh
```

The installer prompts for domain, admin email, deploy mode, repo, branch, app directory, and database settings. Pressing ENTER accepts the shown default for every prompt. It installs Node.js, pnpm, PostgreSQL, Redis, Nginx, PM2, prepares shared storage, writes production env, runs Prisma generate/migrate, seeds a generated admin, builds Next.js, configures SSL/firewall/Nginx, starts PM2, saves PM2 startup state, and verifies the local app, API, PM2, Nginx, database, Redis, SSL, admin login, and WebSocket proxy path.

Browser/WhatsApp automation defaults off. Core panel installs do not require Chromium; if automation is enabled, the installer tries safe browser fallbacks and continues with warnings if a system browser is unavailable. The installer never installs `chromium` or `libasound2t64` as required apt packages.

For bootstrap use, the same `install.sh` can be run from outside the app tree. It creates `/var/www/myrdphub`, builds a disposable candidate, and promotes it into the single production source.

## 4. Environment

```bash
cp .env.example .env
chmod 600 .env
```

Fill only secrets and connector values. Business policy is stored in the database-backed settings system, not in `.env`.

Minimum values:

- `APP_URL`
- `NEXT_PUBLIC_APP_URL`
- `DATABASE_URL`
- `REDIS_URL`
- session/auth secrets
- `SECRET_ENCRYPTION_KEY`
- admin bootstrap email

Generate strong secrets with:

```bash
openssl rand -base64 48
openssl rand -hex 32
```

## 5. PM2 Runtime

```bash
pm2 list
pm2 logs zws-web --lines 100
pm2 logs zws-whatsapp --lines 100
```

Expected apps are `zws-web`, `zws-whatsapp`, `zws-worker`, and `zws-vnc-proxy`, with one instance of each.

## 6. First Admin Steps

1. Open `/admin` with the generated admin credentials printed by `install.sh`.
2. Configure platform, branding, SMTP, domains, payment gateways, security, and console settings.
3. Add Proxmox compute nodes and run Test Connection.
4. Sync OS templates and storage pools.
5. Sync templates from each node and keep enough storage, RAM, CPU headroom, and IP capacity available for provisioning.
6. Configure IP pools, storage pools, failover rules, product/node assignments, queue limits, and rate limits from admin settings.
7. Keep Environment Mode in test until checkout, webhooks, wallet, provisioning, reinstall migration, manual delivery, and RDP/SSH access are proven.

## Node Routing

- A selected node only shows templates synced to that node.
- A selected OS template only shows compatible active nodes that have that exact template family/version.
- Every active node can use any active template that exists on that node.
- Provisioning validates template existence, storage, RAM, CPU visibility, IP capacity, queue capacity, and Proxmox health.
- Preflight returns candidate reasons when no compatible node can be selected.

## Updates

Official one-line update:

```bash
curl -fsSL https://myrdphub.com/update.sh | bash
```

The updater backs up files and database state, pulls `main`, installs dependencies, runs Prisma migrations, builds, reloads PM2, runs health checks, and rolls back on failure.

## 7. Payment Smoke

- Gateway checkout should redirect to Cashfree or PhonePe.
- Wallet checkout should settle immediately if balance covers the full payable amount.
- Webhooks and status reconciliation should call shared paid finalization once.
- VPS CPU/RAM upgrades must redirect to payment and apply only after paid confirmation.
