#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="${ZWS_REPO_URL:-https://github.com/samvpslio/myrdphub-platform.git}"
BRANCH="${ZWS_BRANCH:-main}"
ROOT_DIR="${ROOT_DIR:-${APP_DIR:-/var/www/myrdphub}}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
DOMAIN="${DOMAIN:-${SITE_DOMAIN:-aws.myrdphub.com}}"
APP_URL="${APP_URL:-https://$DOMAIN}"
DATABASE_MODE="${DATABASE_MODE:-external}"
DATABASE_TUNNEL_HOSTNAME="${DATABASE_TUNNEL_HOSTNAME:-db.myrdphub.com}"
DATABASE_TUNNEL_PORT="${DATABASE_TUNNEL_PORT:-15432}"
DATABASE_NAME="${DATABASE_NAME:-zwscloud}"
DATABASE_USER="${DATABASE_USER:-zwscloud_app}"
POSTGRES_DB="${POSTGRES_DB:-$DATABASE_NAME}"
POSTGRES_USER="${POSTGRES_USER:-$DATABASE_USER}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(openssl rand -hex 24 2>/dev/null || date +%s)}"
DATABASE_PASSWORD="${DATABASE_PASSWORD:-$POSTGRES_PASSWORD}"
EXTERNAL_DATABASE_URL="${EXTERNAL_DATABASE_URL:-${DATABASE_URL:-postgresql://${DATABASE_USER}:${DATABASE_PASSWORD}@db-tunnel:${DATABASE_TUNNEL_PORT}/${DATABASE_NAME}?schema=public&sslmode=require}}"
DB_SSH_HOST="${DB_SSH_HOST:-151.243.146.253}"
DB_SSH_USER="${DB_SSH_USER:-root}"
DB_SSH_KEY="${DB_SSH_KEY:-}"
DB_BOOTSTRAP="${DB_BOOTSTRAP:-1}"

log() { printf '[zws-install] %s\n' "$*"; }
fail() { printf '[zws-install] ERROR: %s\n' "$*" >&2; exit 1; }

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

detect_ssh_key() {
  if [[ -n "$DB_SSH_KEY" ]]; then
    printf '%s' "$DB_SSH_KEY"
    return
  fi
  for candidate in "$PWD/sam-key-all" "$ROOT_DIR/sam-key-all" "$HOME/.ssh/id_ed25519" "$HOME/.ssh/id_rsa"; do
    if [[ -f "$candidate" ]]; then
      chmod 0600 "$candidate" 2>/dev/null || true
      printf '%s' "$candidate"
      return
    fi
  done
}

ssh_opts() {
  local key
  key="$(detect_ssh_key)"
  printf '%s\n' "-o" "BatchMode=yes" "-o" "StrictHostKeyChecking=accept-new" "-o" "ConnectTimeout=15"
  if [[ -n "$key" ]]; then
    printf '%s\n' "-i" "$key"
  fi
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

secret_base64() { openssl rand -base64 48 | tr -d '\n'; }
secret_hex32() { openssl rand -hex 32 | tr -d '\n'; }

write_env_if_missing() {
  if [[ -f "$ENV_FILE" ]]; then
    log "Keeping existing env file: $ENV_FILE"
    return
  fi
  log "Writing Docker env file: $ENV_FILE"
  umask 077
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
ZWS_RUNTIME=docker
ZWS_STARTUP_STRICT=1
DATABASE_MODE=$DATABASE_MODE
COMPOSE_PROFILES=$(if [[ "$DATABASE_MODE" == "local" ]]; then printf 'local-db'; else printf 'db-tunnel'; fi)
DATABASE_URL=
DOCKER_DATABASE_URL=
DATABASE_TUNNEL_HOSTNAME=$DATABASE_TUNNEL_HOSTNAME
DATABASE_TUNNEL_PORT=$DATABASE_TUNNEL_PORT
DATABASE_HOST=$(if [[ "$DATABASE_MODE" == "local" ]]; then printf 'postgres'; else printf 'db-tunnel'; fi)
DATABASE_PORT=$(if [[ "$DATABASE_MODE" == "local" ]]; then printf '5432'; else printf '%s' "$DATABASE_TUNNEL_PORT"; fi)
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
DOCKER_LOCAL_DATABASE_URL=postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@postgres:5432/$POSTGRES_DB?schema=public
POSTGRES_DB=$POSTGRES_DB
POSTGRES_USER=$POSTGRES_USER
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
REDIS_URL=
DOCKER_REDIS_URL=redis://redis:6379/0
SITE_DOMAIN=$DOMAIN
APP_URL=$APP_URL
NEXTAUTH_URL=$APP_URL
NEXT_PUBLIC_APP_URL=$APP_URL
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

bootstrap_database_server() {
  if [[ "$DATABASE_MODE" != "external" || "$DB_BOOTSTRAP" != "1" ]]; then
    log "Skipping remote database bootstrap"
    return
  fi
  local script="$ROOT_DIR/ops/aws-db-server-setup.sh"
  [[ -f "$script" ]] || fail "Database bootstrap script missing: $script"
  log "Bootstrapping PostgreSQL server ${DB_SSH_USER}@${DB_SSH_HOST}"
  mapfile -t opts < <(ssh_opts)
  ssh "${opts[@]}" "${DB_SSH_USER}@${DB_SSH_HOST}" \
    "ZWS_DB_USER='$DATABASE_USER' ZWS_DB_PASSWORD='$DATABASE_PASSWORD' ZWS_DB_NAMES='zwscloud zwscloud_staging zwscloud_test' ZWS_PRIMARY_DB='zwscloud' ZWS_DB_HOSTNAME='$DATABASE_TUNNEL_HOSTNAME' bash -s" < "$script"
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

configure_cloudflare_only_firewall() {
  if [[ "${CLOUDFLARE_ONLY_MODE:-false}" != "true" ]]; then
    log "Cloudflare-only firewall mode disabled. Recommended production mode: CLOUDFLARE_ONLY_MODE=true DIRECT_CLOUDFLARE_MODE=true."
    return
  fi
  log "Applying Cloudflare-only firewall baseline: allow SSH, deny public app/database/cache/web ports"
  if command -v ufw >/dev/null 2>&1; then
    ufw allow 22/tcp || true
    for port in 80 443 3000 8080 8000 5000 5432 6379; do
      ufw deny "${port}/tcp" || true
    done
    ufw --force enable || true
  elif command -v firewall-cmd >/dev/null 2>&1; then
    systemctl enable --now firewalld || true
    firewall-cmd --permanent --add-service=ssh || true
    for port in 80 443 3000 8080 8000 5000 5432 6379; do
      firewall-cmd --permanent --remove-port="${port}/tcp" || true
    done
    firewall-cmd --reload || true
  fi
}

start_stack() {
  log "Building and starting Docker services"
  # shellcheck disable=SC2046
  docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/docker-compose.yml" $(compose_profiles) up -d --build --remove-orphans
  log "Docker service status"
  docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/docker-compose.yml" ps
}

main() {
  require_root
  require_supported_os
  install_packages
  sync_repo
  write_env_if_missing
  prepare_origin_certs
  configure_cloudflare_only_firewall
  bootstrap_database_server
  start_stack
  log "Install complete. Update $ENV_FILE with Proxmox and Evolution API settings, then run: docker compose --env-file $ENV_FILE -f $ROOT_DIR/docker-compose.yml up -d --build"
}

main "$@"
