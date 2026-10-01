#!/usr/bin/env bash
set -Eeuo pipefail

# ZWS Cloud Panel - Direct Production Installer
# No GitHub, no git clone - downloads everything from production server
# Usage: curl -fsSL https://zwscloud.com/install.sh | sudo bash

INSTALL_API="${ZWS_INSTALL_API:-https://zwscloud.com/api/install}"
INSTALL_DIR="${ROOT_DIR:-/var/www/myrdphub}"
DOMAIN="${DOMAIN:-}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
DATABASE_MODE="${DATABASE_MODE:-external}"

log() { printf '[zws-install] %s\n' "$*"; }
fail() { printf '[zws-install] ERROR: %s\n' "$*" >&2; exit 1; }
prompt() { printf '[zws-install] %s ' "$*" >&2; }
prompt_secret() { printf '[zws-install] %s ' "$*" >&2; read -rs; printf '\n'; }

require_root() {
  [[ "$(id -u)" -eq 0 ]] || fail "Run as root: sudo bash install.sh"
}

require_supported_os() {
  [[ -r /etc/os-release ]] || fail "Cannot detect operating system"
  . /etc/os-release
  [[ "${ID:-}" == "ubuntu" ]] || fail "Fresh Ubuntu 22.04 or newer is required"
  local major="${VERSION_ID%%.*}"
  [[ "${major:-0}" -ge 22 ]] || fail "Ubuntu 22.04 or newer is required"
}

prompt_configuration() {
  log "=== ZWS Cloud Panel Installation ==="
  
  if [[ -z "$DOMAIN" ]]; then
    prompt "Domain (e.g., apexnods.com): "
    read -r DOMAIN
    [[ -n "$DOMAIN" ]] || fail "Domain is required"
  fi
  
  if [[ -z "$ADMIN_EMAIL" ]]; then
    prompt "Admin email (e.g., founder@apexnods.com): "
    read -r ADMIN_EMAIL
    [[ -n "$ADMIN_EMAIL" ]] || fail "Admin email is required"
  fi
  
  if [[ -z "$ADMIN_USERNAME" ]]; then
    prompt "Admin username [admin]: "
    read -r ADMIN_USERNAME
    ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
  fi
  
  while [[ -z "$ADMIN_PASSWORD" ]]; do
    prompt_secret "Admin password (min 8 chars): "
    ADMIN_PASSWORD="$REPLY"
    [[ ${#ADMIN_PASSWORD} -ge 8 ]] || { printf '[zws-install] Password must be at least 8 characters\n'; ADMIN_PASSWORD=""; }
  done
  prompt_secret "Confirm admin password: "
  [[ "$ADMIN_PASSWORD" == "$REPLY" ]] || fail "Passwords do not match"
  
  export DOMAIN ADMIN_EMAIL ADMIN_USERNAME ADMIN_PASSWORD
}

install_docker() {
  log "Installing Docker Engine..."
  if command -v docker >/dev/null 2>&1; then
    log "Docker already installed"
    return
  fi
  
  apt-get update
  apt-get install -y ca-certificates curl gnupg lsb-release
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
}

download_release() {
  log "Downloading release from $INSTALL_API..."
  
  mkdir -p "$INSTALL_DIR"
  cd "$INSTALL_DIR"
  
  # Download docker-compose.yml
  log "Fetching docker-compose.yml..."
  curl -fsSL "$INSTALL_API/compose" -o docker-compose.yml || fail "Failed to download docker-compose.yml"
  
  # Download .env template
  log "Fetching environment template..."
  curl -fsSL "$INSTALL_API/env" -o .env.template || fail "Failed to download .env template"
  
  # Generate .env from template
  log "Generating .env file..."
  local nxt_secret=$(openssl rand -base64 48 | tr -d '\n')
  local enc_key=$(openssl rand -hex 32 | tr -d '\n')
  local mfa_key=$(openssl rand -hex 32 | tr -d '\n')
  local db_pass=$(openssl rand -hex 24 | tr -d '\n')
  
  if [[ "$DATABASE_MODE" == "local" ]]; then
    local db_url="postgresql://zwscloud_app:${db_pass}@postgres:5432/zwscloud?schema=public"
    local docker_db_url="postgresql://zwscloud_app:${db_pass}@postgres:5432/zwscloud?schema=public"
  else
    local db_url="postgresql://zwscloud_app:${db_pass}@db-tunnel:15432/zwscloud?schema=public&sslmode=require"
    local docker_db_url="postgresql://zwscloud_app:${db_pass}@postgres:5432/zwscloud?schema=public"
  fi
  
  cat > .env <<EOF
NODE_ENV=production
ZWS_RUNTIME=docker
ZWS_STARTUP_STRICT=1
DATABASE_MODE=$DATABASE_MODE
COMPOSE_PROFILES=$(if [[ "$DATABASE_MODE" == "local" ]]; then printf 'local-db'; else printf 'db-tunnel'; fi)
DATABASE_URL=
DOCKER_DATABASE_URL=
DATABASE_TUNNEL_HOSTNAME=${DATABASE_TUNNEL_HOSTNAME:-db.zwscloud.com}
DATABASE_TUNNEL_PORT=${DATABASE_TUNNEL_PORT:-15432}
DATABASE_HOST=$(if [[ "$DATABASE_MODE" == "local" ]]; then printf 'postgres'; else printf 'db-tunnel'; fi)
DATABASE_PORT=$(if [[ "$DATABASE_MODE" == "local" ]]; then printf '5432'; else printf '%s' "${DATABASE_TUNNEL_PORT:-15432}"; fi)
DATABASE_NAME=zwscloud
DATABASE_USER=zwscloud_app
DATABASE_PASSWORD=$db_pass
DATABASE_SSLMODE=require
CLOUDFLARED_CONFIG_DIR=/root/.cloudflared
TUNNEL_SERVICE_TOKEN_ID=
TUNNEL_SERVICE_TOKEN_SECRET=
EXTERNAL_DATABASE_URL=
DOCKER_EXTERNAL_DATABASE_URL=
LOCAL_DATABASE_URL=
DOCKER_LOCAL_DATABASE_URL=$docker_db_url
POSTGRES_DB=zwscloud
POSTGRES_USER=zwscloud_app
POSTGRES_PASSWORD=$db_pass
REDIS_URL=
DOCKER_REDIS_URL=redis://redis:6379/0
SITE_DOMAIN=$DOMAIN
APP_URL=https://$DOMAIN
NEXTAUTH_URL=https://$DOMAIN
NEXT_PUBLIC_APP_URL=https://$DOMAIN
NEXTAUTH_SECRET=$nxt_secret
ENCRYPTION_KEY=$enc_key
MFA_ENCRYPTION_KEY=$mfa_key
WHATSAPP_PROVIDER=evolution
EVOLUTION_API_URL=
EVOLUTION_INSTANCE=
EVOLUTION_API_KEY=
EVOLUTION_INSTANCE_TOKEN=
EVOLUTION_TEST_RECIPIENT=
VNC_PROXY_HOST=0.0.0.0
VNC_PROXY_PORT=3001
WORKER_HEALTH_PORT=3100
SCHEDULER_HEALTH_PORT=3101
BROWSER_AUTOMATION_ENABLED=1
CLOUDFLARE_ONLY_MODE=${CLOUDFLARE_ONLY_MODE:-false}
DIRECT_CLOUDFLARE_MODE=${DIRECT_CLOUDFLARE_MODE:-false}
CF_TUNNEL_SERVICE=http://app:3000
PROXMOX_LIVE_SSE_POLL_MS=1000
EOF
  
  chmod 600 .env
}

prepare_certs() {
  log "Preparing TLS certificates..."
  local cert_dir="$INSTALL_DIR/certs"
  mkdir -p "$cert_dir"
  if [[ ! -s "$cert_dir/fullchain.pem" ]]; then
    openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
      -keyout "$cert_dir/origin.key" \
      -out "$cert_dir/origin.crt" \
      -subj "/CN=$DOMAIN" \
      -addext "subjectAltName=DNS:$DOMAIN" >/dev/null 2>&1
    cp "$cert_dir/origin.crt" "$cert_dir/fullchain.pem"
    cp "$cert_dir/origin.key" "$cert_dir/privkey.pem"
    chmod 600 "$cert_dir/origin.key" "$cert_dir/privkey.pem"
    chmod 644 "$cert_dir/origin.crt" "$cert_dir/fullchain.pem"
  fi
}

start_services() {
  log "Starting Docker services..."
  cd "$INSTALL_DIR"
  
  local profiles=""
  if [[ "$DATABASE_MODE" == "local" ]]; then
    profiles="--profile local-db"
  else
    profiles="--profile db-tunnel"
  fi
  
  docker compose --env-file .env -f docker-compose.yml $profiles up -d --build --remove-orphans
  log "Waiting for services to be healthy..."
  sleep 10
}

run_migrations() {
  log "Running database migrations..."
  cd "$INSTALL_DIR"
  docker compose --env-file .env -f docker-compose.yml run --rm migrate
}

seed_admin() {
  log "Creating admin user..."
  cd "$INSTALL_DIR"
  docker compose --env-file .env -f docker-compose.yml run --rm app node -e "
    const { PrismaClient } = require('@prisma/client');
    const bcrypt = require('bcryptjs');
    const prisma = new PrismaClient();
    async function main() {
      const existing = await prisma.user.findUnique({ where: { email: '$ADMIN_EMAIL' } });
      const hash = await bcrypt.hash('$ADMIN_PASSWORD', 12);
      if (existing) {
        await prisma.user.update({ where: { email: '$ADMIN_EMAIL' }, data: { passwordHash: hash, name: '$ADMIN_USERNAME', role: 'ADMIN', emailVerified: new Date() } });
        console.log('Admin updated');
      } else {
        await prisma.user.create({ data: { email: '$ADMIN_EMAIL', name: '$ADMIN_USERNAME', passwordHash: hash, role: 'ADMIN', emailVerified: new Date() } });
        console.log('Admin created');
      }
    }
    main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.\$disconnect());
  "
}

health_check() {
  log "Performing health checks..."
  local max_wait=180
  local waited=0
  
  while [[ $waited -lt $max_wait ]]; do
    if curl -fsS "http://localhost:3000/api/health" >/dev/null 2>&1; then
      log "Application: HEALTHY"
      break
    fi
    sleep 5
    waited=$((waited + 5))
  done
  [[ $waited -lt $max_wait ]] || fail "Application health check timed out"
  
  # Check database
  if [[ "$DATABASE_MODE" == "local" ]]; then
    docker compose --env-file .env -f docker-compose.yml exec -T postgres pg_isready -U zwscloud_app -d zwscloud >/dev/null 2>&1 && log "Database: HEALTHY" || fail "Database unhealthy"
  else
    log "Database: EXTERNAL MODE (skipping local check)"
  fi
  
  docker compose --env-file .env -f docker-compose.yml exec -T redis redis-cli ping >/dev/null 2>&1 && log "Redis: HEALTHY" || fail "Redis unhealthy"
  
  curl -fsS "http://localhost:3100/health" >/dev/null 2>&1 && log "Worker: HEALTHY" || log "Worker: STARTING"
  curl -fsS "http://localhost:3101/health" >/dev/null 2>&1 && log "Scheduler: HEALTHY" || log "Scheduler: STARTING"
}

verify_https() {
  log "Verifying HTTPS for https://$DOMAIN..."
  local max_wait=60
  local waited=0
  while [[ $waited -lt $max_wait ]]; do
    if curl -fsS -I "https://$DOMAIN" 2>/dev/null | grep -q "200\|301\|302"; then
      log "HTTPS: OK (https://$DOMAIN)"
      return
    fi
    sleep 5
    waited=$((waited + 5))
  done
  log "HTTPS: PENDING - Ensure DNS points to this server"
}

main() {
  require_root
  require_supported_os
  prompt_configuration
  install_docker
  download_release
  prepare_certs
  start_services
  run_migrations
  seed_admin
  health_check
  verify_https
  
  log ""
  log "=== Installation Complete ==="
  log "Admin URL: https://$DOMAIN"
  log "Admin Email: $ADMIN_EMAIL"
  log "Admin Username: $ADMIN_USERNAME"
  log ""
  log "Next steps:"
  log "1. Update $INSTALL_DIR/.env with Proxmox node credentials"
  log "2. Update $INSTALL_DIR/.env with Evolution API settings for WhatsApp"
  log "3. Restart: docker compose --env-file $INSTALL_DIR/.env -f $INSTALL_DIR/docker-compose.yml up -d"
}

main "$@"