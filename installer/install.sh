#!/usr/bin/env bash
set -Eeuo pipefail

# ZWS Cloud Panel - Production Installer
# This is the main installer called by install-source.sh

REPO_URL="${ZWS_REPO_URL:-https://github.com/Lucky-UEDC/zws-cloud-panel.git}"
BRANCH="${ZWS_BRANCH:-main}"
ROOT_DIR="${ROOT_DIR:-/var/www/myrdphub}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"

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

# Interactive prompts for required configuration
prompt_configuration() {
  log "Configuration required for production installation"
  
  # Domain
  if [[ -z "${DOMAIN:-}" ]] || [[ "${DOMAIN}" == "zwscloud.com" ]]; then
    prompt "Domain (e.g., apexnods.com): "
    read -r DOMAIN
    [[ -n "$DOMAIN" ]] || fail "Domain is required"
  else
    log "Using domain from environment: $DOMAIN"
  fi
  
  # Admin email
  if [[ -z "${ADMIN_EMAIL:-}" ]] || [[ "${ADMIN_EMAIL}" == "admin@zwscloud.com" ]]; then
    prompt "Admin email (e.g., founder@apexnods.com): "
    read -r ADMIN_EMAIL
    [[ -n "$ADMIN_EMAIL" ]] || fail "Admin email is required"
  else
    log "Using admin email from environment: $ADMIN_EMAIL"
  fi
  
  # Admin username
  if [[ -z "${ADMIN_USERNAME:-}" ]]; then
    prompt "Admin username [admin]: "
    read -r ADMIN_USERNAME
    ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
  else
    log "Using admin username from environment: $ADMIN_USERNAME"
  fi
  
  # Admin password
  if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
    while true; do
      prompt_secret "Admin password (min 8 chars): "
      ADMIN_PASSWORD="$REPLY"
      if [[ ${#ADMIN_PASSWORD} -ge 8 ]]; then
        break
      fi
      printf '[zws-install] Password must be at least 8 characters\n' >&2
    done
    prompt_secret "Confirm admin password: "
    local confirm="$REPLY"
    [[ "$ADMIN_PASSWORD" == "$confirm" ]] || fail "Passwords do not match"
  else
    log "Using admin password from environment"
  fi
  
  export DOMAIN ADMIN_EMAIL ADMIN_USERNAME ADMIN_PASSWORD
}

detect_database_mode() {
  # Default to external database mode (Cloudflare tunnel)
  # Local mode uses postgres container
  DATABASE_MODE="${DATABASE_MODE:-external}"
  export DATABASE_MODE
}

install_packages() {
  log "Installing Docker, Docker Compose, git, curl, openssl, and Cloudflared"
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl git gnupg openssl ufw fail2ban
    install -m 0755 -d /etc/apt/keyrings
    if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
      curl -fsSL https://download.docker.com/linux/$(. /etc/os-release && echo "$ID")/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
      chmod a+r /etc/apt/keyrings/docker.gpg
    fi
    . /etc/os-release
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    if ! command -v cloudflared >/dev/null 2>&1; then
      curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
      chmod +x /usr/local/bin/cloudflared
    fi
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y dnf-plugins-core ca-certificates curl git openssl firewalld fail2ban
    dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
    dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    if ! command -v cloudflared >/dev/null 2>&1; then
      curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
      chmod +x /usr/local/bin/cloudflared
    fi
  else
    fail "Supported package manager required: apt-get or dnf"
  fi
  systemctl enable --now docker
}

secret_base64() { openssl rand -base64 48 | tr -d '\n'; }
secret_hex32() { openssl rand -hex 32 | tr -d '\n'; }

write_env_if_missing() {
  if [[ -f "$ENV_FILE" ]]; then
    log "Keeping existing env file: $ENV_FILE"
    return
  fi
  
  log "Writing Docker env file: $ENV_FILE"
  umask 077
  
  local db_host db_port db_url docker_db_url
  if [[ "$DATABASE_MODE" == "local" ]]; then
    db_host="postgres"
    db_port="5432"
    db_url="postgresql://${DATABASE_USER}:${DATABASE_PASSWORD}@postgres:5432/${DATABASE_NAME}?schema=public"
    docker_db_url="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?schema=public"
  else
    db_host="db-tunnel"
    db_port="${DATABASE_TUNEL_PORT:-15432}"
    db_url="postgresql://${DATABASE_USER}:${DATABASE_PASSWORD}@db-tunnel:${DATABASE_TUNEL_PORT:-15432}/${DATABASE_NAME}?schema=public&sslmode=require"
    docker_db_url="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?schema=public"
  fi
  
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
ZWS_RUNTIME=docker
ZWS_STARTUP_STRICT=1
DATABASE_MODE=$DATABASE_MODE
COMPOSE_PROFILES=$(if [[ "$DATABASE_MODE" == "local" ]]; then printf 'local-db'; else printf 'db-tunnel'; fi)
DATABASE_URL=
DOCKER_DATABASE_URL=
DATABASE_TUNNEL_HOSTNAME=${DATABASE_TUNNEL_HOSTNAME:-db.zwscloud.com}
DATABASE_TUNNEL_PORT=${DATABASE_TUNNEL_PORT:-15432}
DATABASE_HOST=$db_host
DATABASE_PORT=$db_port
DATABASE_NAME=$DATABASE_NAME
DATABASE_USER=$DATABASE_USER
DATABASE_PASSWORD=$DATABASE_PASSWORD
DATABASE_SSLMODE=require
CLOUDFLARED_CONFIG_DIR=/root/.cloudflared
TUNNEL_SERVICE_TOKEN_ID=${TUNNEL_SERVICE_TOKEN_ID:-}
TUNNEL_SERVICE_TOKEN_SECRET=${TUNNEL_SERVICE_TOKEN_SECRET:-}
EXTERNAL_DATABASE_URL=
DOCKER_EXTERNAL_DATABASE_URL=$EXTERNAL_DATABASE_URL
LOCAL_DATABASE_URL=
DOCKER_LOCAL_DATABASE_URL=$docker_db_url
POSTGRES_DB=${POSTGRES_DB:-$DATABASE_NAME}
POSTGRES_USER=${POSTGRES_USER:-$DATABASE_USER}
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
REDIS_URL=
DOCKER_REDIS_URL=redis://redis:6379/0
SITE_DOMAIN=$DOMAIN
APP_URL=https://$DOMAIN
NEXTAUTH_URL=https://$DOMAIN
NEXT_PUBLIC_APP_URL=https://$DOMAIN
NEXTAUTH_SECRET=$(secret_base64)
ENCRYPTION_KEY=$(secret_hex32)
MFA_ENCRYPTION_KEY=$(secret_hex32)
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
}

prepare_origin_certs() {
  local cert_dir="$ROOT_DIR/certs"
  if [[ -s "$cert_dir/fullchain.pem" && -s "$cert_dir/privkey.pem" ]]; then
    return
  fi
  log "Preparing local origin certificate for Nginx container"
  install -d -m 0755 "$cert_dir"
  openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
    -keyout "$cert_dir/origin.key" \
    -out "$cert_dir/origin.crt" \
    -subj "/CN=$DOMAIN" \
    -addext "subjectAltName=DNS:$DOMAIN" >/dev/null 2>&1
  cp "$cert_dir/origin.crt" "$cert_dir/fullchain.pem"
  cp "$cert_dir/origin.key" "$cert_dir/privkey.pem"
  chmod 0644 "$cert_dir/origin.crt"
  chmod 0600 "$cert_dir/origin.key"
  chmod 0644 "$cert_dir/fullchain.pem"
  chmod 0600 "$cert_dir/privkey.pem"
}

sync_repo() {
  mkdir -p "$(dirname "$ROOT_DIR")"
  if [[ -d "$ROOT_DIR/.git" ]]; then
    log "Updating repository at $ROOT_DIR"
    git -C "$ROOT_DIR" fetch origin "$BRANCH"
    git -C "$ROOT_DIR" checkout "$BRANCH"
    git -C "$ROOT_DIR" pull --ff-only origin "$BRANCH"
  else
    log "Cloning repository to $ROOT_DIR"
    rm -rf "$ROOT_DIR"
    git clone --branch "$BRANCH" "$REPO_URL" "$ROOT_DIR"
  fi
}

compose_profiles() {
  if [[ "$DATABASE_MODE" == "local" ]]; then
    printf -- '--profile local-db '
  else
    printf -- '--profile db-tunnel '
  fi
  if [[ "${DIRECT_CLOUDFLARE_MODE:-false}" == "true" ]]; then
    printf -- '--profile direct-cloudflare '
  else
    printf -- '--profile nginx '
  fi
}

start_stack() {
  log "Building and starting Docker services"
  # shellcheck disable=SC2046
  docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/docker-compose.yml" $(compose_profiles) up -d --build --remove-orphans
  log "Docker service status"
  docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/docker-compose.yml" ps
}

run_migrations() {
  log "Running database migrations"
  docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/docker-compose.yml" run --rm migrate
}

seed_admin() {
  log "Seeding admin user"
  docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/docker-compose.yml" run --rm app node -e "
    const { PrismaClient } = require('@prisma/client');
    const bcrypt = require('bcryptjs');
    const prisma = new PrismaClient();
    async function main() {
      const existing = await prisma.user.findUnique({ where: { email: '$ADMIN_EMAIL' } });
      if (existing) {
        console.log('Admin user already exists, updating password...');
        const hash = await bcrypt.hash('$ADMIN_PASSWORD', 12);
        await prisma.user.update({
          where: { email: '$ADMIN_EMAIL' },
          data: { passwordHash: hash, name: '$ADMIN_USERNAME', role: 'ADMIN', emailVerified: new Date() }
        });
        console.log('Admin user updated');
      } else {
        const hash = await bcrypt.hash('$ADMIN_PASSWORD', 12);
        await prisma.user.create({
          data: { email: '$ADMIN_EMAIL', name: '$ADMIN_USERNAME', passwordHash: hash, role: 'ADMIN', emailVerified: new Date() }
        });
        console.log('Admin user created');
      }
    }
    main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.\$disconnect());
  "
}

health_check() {
  log "Performing health checks..."
  local max_wait=180
  local waited=0
  local interval=5
  
  # Wait for app to be healthy
  while [[ $waited -lt $max_wait ]]; do
    if curl -fsS "http://localhost:3000/api/health" >/dev/null 2>&1; then
      log "Application health check: PASS"
      break
    fi
    sleep $interval
    waited=$((waited + interval))
    log "Waiting for application... ($waited/${max_wait}s)"
  done
  
  if [[ $waited -ge $max_wait ]]; then
    fail "Application health check timed out after ${max_wait}s"
  fi
  
  # Check database
  if ! docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/docker-compose.yml" exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
    if [[ "$DATABASE_MODE" == "external" ]]; then
      log "External database mode - skipping local postgres check"
    else
      fail "Database health check failed"
    fi
  else
    log "Database health check: PASS"
  fi
  
  # Check Redis
  if ! docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/docker-compose.yml" exec -T redis redis-cli ping >/dev/null 2>&1; then
    fail "Redis health check failed"
  fi
  log "Redis health check: PASS"
  
  # Check worker
  if ! curl -fsS "http://localhost:3100/health" >/dev/null 2>&1; then
    log "Worker health check: WARNING (may still be starting)"
  else
    log "Worker health check: PASS"
  fi
  
  # Check scheduler
  if ! curl -fsS "http://localhost:3101/health" >/dev/null 2>&1; then
    log "Scheduler health check: WARNING (may still be starting)"
  else
    log "Scheduler health check: PASS"
  fi
}

verify_https() {
  log "Verifying HTTPS..."
  local max_wait=60
  local waited=0
  local interval=5
  
  while [[ $waited -lt $max_wait ]]; do
    if curl -fsS -I "https://$DOMAIN" 2>/dev/null | grep -q "200\|301\|302"; then
      log "HTTPS verification: PASS (https://$DOMAIN)"
      break
    fi
    sleep $interval
    waited=$((waited + interval))
  done
  
  if [[ $waited -ge $max_wait ]]; then
    log "HTTPS verification: WARNING - domain may not be pointing to this server yet"
    log "Check DNS: dig +short $DOMAIN"
  fi
}

main() {
  log "=== ZWS Cloud Panel Production Installer ==="
  
  require_root
  require_supported_os
  
  prompt_configuration
  detect_database_mode
  
  install_packages
  sync_repo
  write_env_if_missing
  prepare_origin_certs
  start_stack
  run_migrations
  seed_admin
  health_check
  verify_https
  
  log "=== Installation Complete ==="
  log "Admin URL: https://$DOMAIN"
  log "Admin Email: $ADMIN_EMAIL"
  log "Admin Username: $ADMIN_USERNAME"
  log ""
  log "Next steps:"
  log "1. Update $ENV_FILE with Proxmox node credentials"
  log "2. Update $ENV_FILE with Evolution API settings for WhatsApp"
  log "3. Restart services: docker compose --env-file $ENV_FILE -f $ROOT_DIR/docker-compose.yml up -d"
  log ""
  log "To update in the future, run the installer again."
}

main "$@"