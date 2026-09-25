#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${ROOT_DIR:-/var/www/myrdphub}"
BRANCH="${BRANCH:-main}"
REMOTE="${REMOTE:-origin}"
DEFAULT_REPO_URL="${DEFAULT_REPO_URL:-https://github.com/samvpslio/myrdphub-platform.git}"
APP_VERSION="${APP_VERSION:-v1.0.0}"
ACTIVE_DIR="${ACTIVE_DIR:-$ROOT_DIR}"
SHARED_DIR="${SHARED_DIR:-$ROOT_DIR/shared}"
ENV_FILE="${ENV_FILE:-$SHARED_DIR/.env.production}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/myrdphub/production}"
LOG_DIR="${ZWS_LOG_DIR:-$ROOT_DIR/logs}"
LIVE_PORT="${LIVE_PORT:-3000}"
CANDIDATE_PORT="${CANDIDATE_PORT:-3101}"
REQUIRED_PM2_APPS=(zws-web zws-worker zws-whatsapp zws-proxmox-events zws-vnc-proxy)
LEGACY_PM2_APPS=(zws-scheduler zws-cloud zws-provision-worker zws-billing-worker zws-payment-reconcile-worker zws-node-telemetry-worker zws-vm-network-validation-worker zws-renewal-worker zws-queue-worker zws-whatsapp-worker)
STAMP="$(date -u +%Y%m%d-%H%M%S)"
CANDIDATE_DIR="${CANDIDATE_DIR:-/var/tmp/myrdphub-candidate-$STAMP}"
BACKUP_ROOT="$BACKUP_DIR/$STAMP"
SOURCE_BACKUP="$BACKUP_ROOT/source.tgz"
CANDIDATE_PID=""
SWITCHED_RELEASE="0"

log() { printf '[zws-update] %s\n' "$*"; }
warn() { printf '[zws-update] WARNING: %s\n' "$*" >&2; }
fail() { printf '[zws-update] ERROR: %s\n' "$*" >&2; exit 1; }

read_version() {
  local dir="${1:-$CANDIDATE_DIR}"
  if [[ -f "$dir/VERSION" ]]; then
    tr -d '[:space:]' <"$dir/VERSION"
  else
    printf '%s' "$APP_VERSION"
  fi
}

init_logging() {
  mkdir -p "$LOG_DIR"
  touch "$LOG_DIR/update.log"
  exec > >(awk '{ print strftime("[%Y-%m-%dT%H:%M:%SZ]"), $0; fflush(); }' | tee -a "$LOG_DIR/update.log") 2>&1
}

require_root() {
  [[ "$(id -u)" -eq 0 ]] || fail "Run as root: sudo bash update.sh"
}

cleanup_candidate() {
  if [[ -n "$CANDIDATE_PID" ]] && kill -0 "$CANDIDATE_PID" >/dev/null 2>&1; then
    kill "$CANDIDATE_PID" >/dev/null 2>&1 || true
    wait "$CANDIDATE_PID" >/dev/null 2>&1 || true
  fi
}

rollback() {
  local exit_code=$?
  cleanup_candidate
  if [[ "$exit_code" -eq 0 ]]; then return 0; fi
  log "Update failed; rolling back"
  {
    printf '\n[zws-update rollback] source=%s switched=%s\n' "$SOURCE_BACKUP" "$SWITCHED_RELEASE"
    pm2 status || true
    if [[ -f "$SOURCE_BACKUP" ]]; then
      local rollback_dir="/var/tmp/myrdphub-rollback-$STAMP"
      rm -rf "$rollback_dir"
      mkdir -p "$rollback_dir"
      tar -xzf "$SOURCE_BACKUP" -C "$rollback_dir" || true
      rsync -a --delete --exclude '/.env' --exclude '/shared' --exclude '/uploads' --exclude '/logs' "$rollback_dir/" "$ROOT_DIR/" || true
      rm -rf "$rollback_dir"
      pm2 startOrReload "$ROOT_DIR/ecosystem.config.js" --update-env || true
      pm2 save || true
      printf '[zws-update rollback] restored previous source archive\n'
    else
      printf '[zws-update rollback] no source archive available\n'
    fi
    if [[ -f "$BACKUP_ROOT/nginx-myrdphub.conf" ]]; then
      cp -a "$BACKUP_ROOT/nginx-myrdphub.conf" /etc/nginx/sites-available/myrdphub
      ln -sfn /etc/nginx/sites-available/myrdphub /etc/nginx/sites-enabled/myrdphub
      if nginx -t; then
        systemctl reload nginx || true
        printf '[zws-update rollback] restored previous nginx config\n'
      else
        printf '[zws-update rollback] previous nginx config failed validation\n'
      fi
    fi
    if [[ "${DB_ROLLBACK_ON_FAILURE:-1}" == "1" && -f "$BACKUP_ROOT/db.dump" && -n "${DATABASE_URL:-}" && "$(command -v pg_restore || true)" ]]; then
      pg_restore --dbname="$DATABASE_URL" --clean --if-exists --no-owner --no-privileges "$BACKUP_ROOT/db.dump" || printf '[zws-update rollback] database restore failed\n'
    fi
  } >&2
  exit "$exit_code"
}
trap rollback ERR
trap cleanup_candidate EXIT

load_env() {
  [[ -f "$ENV_FILE" ]] || fail "Missing env file: $ENV_FILE"
  local line key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" == \#* || "$line" != *=* ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    if [[ "$value" == \"*\" && "$value" == *\" ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
      value="${value:1:${#value}-2}"
    fi
    export "$key=$value"
  done <"$ENV_FILE"
  export NODE_ENV="${NODE_ENV:-production}"
  export LIVE_BANDWIDTH_POLL_MS="${LIVE_BANDWIDTH_POLL_MS:-1000}"
  export LIVE_BANDWIDTH_CONFIG_REFRESH_MS="${LIVE_BANDWIDTH_CONFIG_REFRESH_MS:-30000}"
  export LIVE_BANDWIDTH_VM_BATCH_SIZE="${LIVE_BANDWIDTH_VM_BATCH_SIZE:-500}"
  export VM_TELEMETRY_POLL_MS="${VM_TELEMETRY_POLL_MS:-30000}"
  export VM_TELEMETRY_BATCH_SIZE="${VM_TELEMETRY_BATCH_SIZE:-500}"
}

env_quote() {
  local value="${1:-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/}"
  printf '"%s"' "$value"
}

env_ensure() {
  local key="$1" value="$2"
  if [[ -f "$ENV_FILE" ]] && grep -q "^${key}=" "$ENV_FILE"; then return; fi
  printf '%s=%s\n' "$key" "$(env_quote "$value")" >>"$ENV_FILE"
}

ensure_env_defaults() {
  log "Ensuring production env defaults"
  mkdir -p "$SHARED_DIR"
  [[ -f "$ENV_FILE" ]] || {
    if [[ -f "$ROOT_DIR/.env" ]]; then
      cp -a "$ROOT_DIR/.env" "$ENV_FILE"
    else
      fail "Missing env file: $ENV_FILE"
    fi
  }
  chmod 0600 "$ENV_FILE"
  env_ensure NODE_ENV production
  env_ensure REDIS_URL "redis://127.0.0.1:6379"
  env_ensure NODE_TELEMETRY_POLL_MS "30000"
  env_ensure NODE_TELEMETRY_CONCURRENCY "2"
  env_ensure VM_TELEMETRY_POLL_MS "30000"
  env_ensure VM_TELEMETRY_CONCURRENCY "4"
  env_ensure VM_TELEMETRY_BATCH_SIZE "500"
  env_ensure LIVE_BANDWIDTH_POLL_MS "1000"
  env_ensure LIVE_BANDWIDTH_CONFIG_REFRESH_MS "30000"
  env_ensure LIVE_BANDWIDTH_VM_BATCH_SIZE "500"
  env_ensure TELEMETRY_HEALTH_MAX_AGE_MS "600000"
  env_ensure WHATSAPP_SESSION_PATH "/storage/whatsapp-session"
  load_env
}

resolve_repo_url() {
  if git -C "$ROOT_DIR" remote get-url "$REMOTE" >/dev/null 2>&1; then
    git -C "$ROOT_DIR" remote get-url "$REMOTE"
  elif [[ -d "$ACTIVE_DIR/.git" ]] && git -C "$ACTIVE_DIR" remote get-url "$REMOTE" >/dev/null 2>&1; then
    git -C "$ACTIVE_DIR" remote get-url "$REMOTE"
  else
    printf '%s\n' "$DEFAULT_REPO_URL"
  fi
}

sync_source_tree() {
  if [[ ! -d "$ROOT_DIR/.git" ]]; then
    log "Root has no Git checkout; using repository candidate only"
    return
  fi
  log "Syncing $ROOT_DIR from $REMOTE/$BRANCH"
  git -C "$ROOT_DIR" fetch "$REMOTE" "$BRANCH" --prune
  git -C "$ROOT_DIR" checkout "$BRANCH"
  git -C "$ROOT_DIR" pull --ff-only "$REMOTE" "$BRANCH"
}

prepare_layout() {
  mkdir -p "$SHARED_DIR" "$LOG_DIR" "$BACKUP_ROOT" "$SHARED_DIR/uploads" /storage/whatsapp-session
  chmod 0700 /storage/whatsapp-session
  ln -sfn /storage/whatsapp-session "$SHARED_DIR/whatsapp-auth"
  if [[ -d "$ROOT_DIR/uploads" && ! -L "$ROOT_DIR/uploads" && ! -e "$SHARED_DIR/uploads/.update-migrated" ]]; then
    log "Migrating legacy uploads into shared storage"
    cp -a "$ROOT_DIR/uploads/." "$SHARED_DIR/uploads/" 2>/dev/null || true
    touch "$SHARED_DIR/uploads/.update-migrated"
  fi
}

backup_current() {
  log "Creating update backup at $BACKUP_ROOT"
  # Hardened permissions: the update backup contains the production .env and a
  # full pg_dump. Create the root 0700 and pin sensitive files to 0600 so local
  # users cannot read DB credentials or data dumps.
  install -d -m 0700 "$BACKUP_ROOT"
  [[ -d "$ROOT_DIR/.git" ]] && git -C "$ROOT_DIR" rev-parse HEAD >"$BACKUP_ROOT/previous-commit.txt" || true
  tar -C "$ROOT_DIR" -czf "$SOURCE_BACKUP" \
    --exclude=./node_modules --exclude=./logs --exclude=./uploads --exclude=./shared \
    --exclude=./backups --exclude=./.env --exclude=./.git --exclude=./current --exclude=./releases .
  [[ -f "$ENV_FILE" ]] && { cp -a "$ENV_FILE" "$BACKUP_ROOT/.env.production"; chmod 0600 "$BACKUP_ROOT/.env.production" 2>/dev/null || true; }
  for nginx_site in myrdphub yatycloud zws; do
    if [[ -f "/etc/nginx/sites-available/$nginx_site" ]]; then
      cp -a "/etc/nginx/sites-available/$nginx_site" "$BACKUP_ROOT/nginx-myrdphub.conf"
      break
    fi
  done
  [[ -f /etc/logrotate.d/zws ]] && cp -a /etc/logrotate.d/zws "$BACKUP_ROOT/logrotate-zws"
  [[ -d "$SHARED_DIR/uploads" ]] && tar -C "$SHARED_DIR" -czf "$BACKUP_ROOT/uploads.tgz" uploads
  if [[ -d /etc/letsencrypt ]]; then tar -C /etc -czf "$BACKUP_ROOT/letsencrypt-metadata.tgz" letsencrypt 2>/dev/null || true; fi
  if command -v pg_dump >/dev/null 2>&1 && [[ -n "${DATABASE_URL:-}" ]]; then
    pg_dump "$DATABASE_URL" --format=custom --file="$BACKUP_ROOT/db.dump" || warn "Database backup failed; continuing with file backups"
    chmod 0600 "$BACKUP_ROOT/db.dump" 2>/dev/null || true
  fi
  chmod 0600 "$BACKUP_ROOT/previous-commit.txt" "$BACKUP_ROOT/nginx-myrdphub.conf" "$BACKUP_ROOT/logrotate-zws" "$BACKUP_ROOT/uploads.tgz" "$BACKUP_ROOT/letsencrypt-metadata.tgz" 2>/dev/null || true
}

link_shared_paths() {
  ln -sfn "$ENV_FILE" "$CANDIDATE_DIR/.env"
  ln -sfn "$LOG_DIR" "$CANDIDATE_DIR/logs"
  ln -sfn "$SHARED_DIR/uploads" "$CANDIDATE_DIR/uploads"
  ln -sfn /storage/whatsapp-session "$CANDIDATE_DIR/whatsapp-auth"
}

cleanup_build_cache() {
  rm -rf "$CANDIDATE_DIR/.next" "$CANDIDATE_DIR/.turbo" "$CANDIDATE_DIR/.cache" "$CANDIDATE_DIR/node_modules/.cache"
}

create_candidate() {
  local repo="$1"
  log "Creating disposable candidate $CANDIDATE_DIR from $repo#$BRANCH"
  rm -rf "$CANDIDATE_DIR"
  git clone --depth 1 --branch "$BRANCH" "$repo" "$CANDIDATE_DIR"
  (cd "$CANDIDATE_DIR" && git rev-parse HEAD >"$BACKUP_ROOT/git-commit.txt")
  rm -rf "$CANDIDATE_DIR/.git"
  link_shared_paths
}

wait_for_health() {
  local url="$1" attempts="${2:-45}"
  for _ in $(seq 1 "$attempts"); do
    if curl -fsS --max-time 8 "$url" >/dev/null; then return 0; fi
    sleep 2
  done
  return 1
}

check_url() {
  local url="$1" label="$2"
  wait_for_health "$url" 45 || fail "$label health check failed: $url"
}

check_pm2_apps() {
  log "Checking PM2 application status"
  local missing extras
  missing="$(node -e '
const required = process.argv.slice(1)
let apps = []
try { apps = JSON.parse(require("child_process").execFileSync("pm2", ["jlist"], { encoding: "utf8" }) || "[]") } catch {}
const byName = new Map(apps.map((app) => [String(app.name), app]))
const bad = required.filter((name) => byName.get(name)?.pm2_env?.status !== "online")
if (bad.length) process.stdout.write(bad.join(","))
' "${REQUIRED_PM2_APPS[@]}")"
  extras="$(node -e '
const required = new Set(process.argv.slice(1))
let apps = []
try { apps = JSON.parse(require("child_process").execFileSync("pm2", ["jlist"], { encoding: "utf8" }) || "[]") } catch {}
const extras = apps.map((app) => String(app.name)).filter((name) => name.startsWith("zws-") && !required.has(name))
if (extras.length) process.stdout.write(extras.join(","))
' "${REQUIRED_PM2_APPS[@]}")"
  [[ -z "$missing" && -z "$extras" ]] || { pm2 status || true; fail "PM2 apps unhealthy; missing/offline: ${missing:-none}; unexpected: ${extras:-none}"; }
}

check_database() {
  log "Checking PostgreSQL connectivity"
  if [[ -n "${DB_PASSWORD:-}" && -n "${DB_USERNAME:-}" && -n "${DB_DATABASE:-}" ]]; then
    PGPASSWORD="$DB_PASSWORD" psql -h "${DB_HOST:-127.0.0.1}" -U "$DB_USERNAME" -d "$DB_DATABASE" -tAc 'SELECT 1' | grep -qx '1' || fail "Database connectivity check failed"
  elif [[ -n "${DATABASE_URL:-}" ]]; then
    psql "$DATABASE_URL" -tAc 'SELECT 1' | grep -qx '1' || fail "Database connectivity check failed"
  else
    fail "Database connectivity check skipped because DATABASE_URL/DB_* env values are missing"
  fi
}

check_redis() {
  log "Checking Redis connectivity"
  redis-cli -u "${REDIS_URL:-redis://127.0.0.1:6379}" ping | grep -qx 'PONG' || fail "Redis connectivity check failed"
}

check_worker_entrypoints() {
  local dir="${1:-$ACTIVE_DIR}" path
  log "Checking worker and route entrypoints in $dir"
  local required=(
    workers/zws-worker.ts workers/zws-web.js scripts/node-telemetry-worker.ts scripts/vm-telemetry-worker.ts
    scripts/live-bandwidth-worker.ts scripts/vnc-proxy-server.ts scripts/provision-worker.ts scripts/proxmox-event-watcher.ts
    app/api/admin/bandwidth/route.ts app/api/admin/bandwidth/live/stream/route.ts
    app/api/admin/compute-nodes/[id]/live/stream/route.ts app/api/admin/compute-nodes/[id]/logs/stream/route.ts
    app/api/admin/compute-nodes/[id]/templates/[templateId]/action/route.ts
    app/api/admin/storage-pools/route.ts app/api/admin/customers/bulk/route.ts
  )
  for path in "${required[@]}"; do [[ -f "$dir/$path" ]] || fail "Missing worker/runtime entrypoint: $path"; done
  (cd "$dir" && node -e '
const fs = require("fs")
const worker = fs.readFileSync("workers/zws-worker.ts", "utf8")
for (const needle of ["scripts/node-telemetry-worker.ts", "scripts/vm-telemetry-worker.ts", "scripts/live-bandwidth-worker.ts", "scripts/provision-worker.ts", "scripts/vnc-proxy-server.ts"]) {
  if (needle === "scripts/vnc-proxy-server.ts") continue
  if (!worker.includes(needle)) throw new Error(`zws-worker is missing ${needle}`)
}
const ecosystem = fs.readFileSync("ecosystem.config.js", "utf8")
for (const app of ["zws-web", "zws-worker", "zws-whatsapp", "zws-proxmox-events", "scripts/proxmox-event-watcher.ts", "zws-vnc-proxy", "scripts/vnc-proxy-server.ts"]) {
  if (!ecosystem.includes(app)) throw new Error(`ecosystem config missing ${app}`)
}
')
}

check_http_surface() {
  local port="${1:-$LIVE_PORT}" dir="${2:-$ACTIVE_DIR}" status path
  log "Checking production panel surfaces on port $port"
  local paths=(
    / /health /api/health /api/runtime/config /api/runtime/config/stream
    /admin/compute-nodes /api/admin/compute-nodes /api/admin/compute-nodes/test
    /api/admin/bandwidth /api/admin/bandwidth/live/stream
    /api/admin/os-templates /api/admin/os-templates/sync
    /api/admin/storage-pools /api/admin/customers/bulk
    /api/admin/vms /api/admin/vms/bulk-lifecycle /api/admin/provision-queue
  )
  for path in "${paths[@]}"; do
    status="$(curl -sS -o /tmp/zws-update-route-check.txt -w '%{http_code}' --max-time 10 "http://127.0.0.1:$port$path" || true)"
    [[ "$status" != "404" && "$status" != "500" && "$status" != "000" ]] || fail "Route check failed for $path with HTTP $status"
  done
  (cd "$dir" && BASE_URL="http://127.0.0.1:$port" pnpm verify:routes)
  (cd "$dir" && SMOKE_BASE_URL="http://127.0.0.1:$port" pnpm smoke:chunks)
}

check_bandwidth_endpoint() {
  local port="${1:-$LIVE_PORT}" dir="${2:-$ACTIVE_DIR}"
  check_http_surface "$port" "$dir"
}

check_compute_ui_endpoint() {
  local port="${1:-$LIVE_PORT}" dir="${2:-$ACTIVE_DIR}"
  check_http_surface "$port" "$dir"
}

check_candidate_route_smoke() {
  local port="${1:-$CANDIDATE_PORT}"
  check_http_surface "$port" "$CANDIDATE_DIR"
}

run_production_tests() {
  if [[ -n "${PRODUCTION_TEST_CMD:-}" ]]; then
    (cd "$CANDIDATE_DIR" && bash -lc "$PRODUCTION_TEST_CMD")
  else
    (cd "$CANDIDATE_DIR" && pnpm test:production)
  fi
}

check_log_rotation() {
  command -v logrotate >/dev/null 2>&1 || fail "logrotate is required for production log rotation"
}

check_nginx_frontend() {
  local host="${SITE_DOMAIN:-localhost}"
  log "Checking frontend through Nginx"
  curl -fsS --max-time 10 -H "Host: $host" "http://127.0.0.1/" >/dev/null || fail "Nginx frontend check failed"
}

check_https_surface() {
  local host="${SITE_DOMAIN:-}" status path
  [[ -n "$host" ]] || return 0
  [[ -f "/etc/letsencrypt/live/$host/fullchain.pem" ]] || return 0
  log "Checking HTTPS production surface"
  local paths=(
    /
    /api/health
    /api/runtime/config
    /admin
    /admin/products
    /admin/compute-nodes
    /admin/whatsapp/template-health
    /client-area
    /client-area/deploy
    /api/admin/provision-queue
  )
  for path in "${paths[@]}"; do
    status="$(curl -sS -o /tmp/zws-update-https-check.txt -w '%{http_code}' --max-time 12 "https://$host$path" || true)"
    [[ "$status" != "000" && "$status" != "404" && "$status" != 5* ]] || fail "HTTPS route check failed for $path with HTTP $status"
  done
}

check_websocket_proxy() {
  local host="${SITE_DOMAIN:-localhost}" status
  log "Checking Nginx WebSocket/SSE path"
  status="$(curl -sS -o /tmp/zws-update-websocket-check.txt -w '%{http_code}' --max-time 10 \
    -H "Host: $host" -H 'Accept: text/event-stream' \
    "http://127.0.0.1/api/runtime/config/stream" || true)"
  [[ "$status" != "000" && "$status" != 5* ]] || fail "Nginx WebSocket/SSE check failed with HTTP $status"
  if [[ -n "${SITE_DOMAIN:-}" && -f "/etc/letsencrypt/live/$SITE_DOMAIN/fullchain.pem" ]]; then
    status="$(curl -sS -o /tmp/zws-update-websocket-https-check.txt -w '%{http_code}' --max-time 10 \
      -H 'Accept: text/event-stream' \
      "https://$SITE_DOMAIN/api/runtime/config/stream" || true)"
    [[ "$status" != "000" && "$status" != 5* ]] || fail "HTTPS WebSocket/SSE check failed with HTTP $status"
  fi
}

check_console_proxy() {
  local status
  log "Checking console proxy health"
  status="$(curl -sS -o /tmp/zws-update-console-proxy.json -w '%{http_code}' --max-time 5 "http://127.0.0.1:${VNC_PROXY_PORT:-3001}/health" || true)"
  [[ "$status" == "200" ]] || fail "Console proxy health check failed with HTTP $status"
}

check_ssl_certificate() {
  local host="${SITE_DOMAIN:-}"
  [[ -n "$host" ]] || return 0
  [[ -f "/etc/letsencrypt/live/$host/fullchain.pem" ]] || return 0
  log "Checking SSL certificate"
  openssl x509 -checkend 86400 -noout -in "/etc/letsencrypt/live/$host/fullchain.pem" >/dev/null || fail "SSL certificate is missing or expires within 24 hours"
}

check_admin_login() {
  [[ -n "${ADMIN_EMAIL:-}" && -n "${ADMIN_PASSWORD:-}" ]] || { log "Skipping admin login check; ADMIN_EMAIL or ADMIN_PASSWORD is not configured"; return 0; }
  log "Checking admin login"
  local cookie_file body_file status
  cookie_file="$(mktemp)"
  body_file="$(umask 077 && mktemp)"
  # Write the credentials to a mode-0600 file so they never appear in the
  # process argument list (visible via ps) and are not world-readable.
  printf '{"email":"%s","password":"%s"}' "$ADMIN_EMAIL" "$ADMIN_PASSWORD" > "$body_file"
  chmod 600 "$body_file" 2>/dev/null || true
  status="$(curl -sS -o /tmp/zws-update-admin-login.json -w '%{http_code}' -c "$cookie_file" -H 'Content-Type: application/json' --data "@$body_file" "http://127.0.0.1:$LIVE_PORT/api/auth/login" || true)"
  chmod 600 /tmp/zws-update-admin-login.json 2>/dev/null || true
  [[ "$status" == "200" ]] || { rm -f "$cookie_file" "$body_file"; fail "Admin login check failed with HTTP $status"; }
  status="$(curl -sS -o /tmp/zws-update-admin-session.json -w '%{http_code}' -b "$cookie_file" "http://127.0.0.1:$LIVE_PORT/api/admin/auth/session" || true)"
  chmod 600 /tmp/zws-update-admin-session.json 2>/dev/null || true
  rm -f "$cookie_file" "$body_file"
  [[ "$status" == "200" ]] || fail "Admin session check failed with HTTP $status"
}

check_live_health() {
  check_url "http://127.0.0.1:$LIVE_PORT/health" "Live app"
  check_url "http://127.0.0.1:$LIVE_PORT/api/health" "Live health API"
  check_url "http://127.0.0.1:$LIVE_PORT/api/runtime/config" "Live API"
  check_url "http://127.0.0.1:$LIVE_PORT/" "Live frontend"
  check_url "http://127.0.0.1:$LIVE_PORT/login" "Login page"
  check_url "http://127.0.0.1:$LIVE_PORT/register" "Register page"
  check_url "http://127.0.0.1:$LIVE_PORT/admin" "Admin page"
  check_pm2_apps
  check_database
  check_redis
  check_worker_entrypoints "$ACTIVE_DIR"
  check_log_rotation
  (cd "$ACTIVE_DIR" && pnpm db:check)
  (cd "$ACTIVE_DIR" && pnpm db:validate:migrations)
  check_bandwidth_endpoint "$LIVE_PORT" "$ACTIVE_DIR"
  check_compute_ui_endpoint "$LIVE_PORT" "$ACTIVE_DIR"
  check_nginx_frontend
  check_https_surface
  check_websocket_proxy
  check_console_proxy
  check_ssl_certificate
  check_admin_login
}

start_candidate() {
  log "Starting candidate on 127.0.0.1:$CANDIDATE_PORT"
  (
    cd "$CANDIDATE_DIR"
    export APP_DIR="$CANDIDATE_DIR" ENV_FILE="$ENV_FILE" HOSTNAME="127.0.0.1" PORT="$CANDIDATE_PORT" NODE_ENV="production" NEXT_TELEMETRY_DISABLED="1"
    exec node .next/standalone/server.js
  ) >"$LOG_DIR/candidate-$STAMP.log" 2>"$LOG_DIR/candidate-$STAMP.error.log" &
  CANDIDATE_PID="$!"
}

configure_logrotate() {
  if [[ -f "$CANDIDATE_DIR/config/logrotate/zws" ]]; then
    cp "$CANDIDATE_DIR/config/logrotate/zws" /etc/logrotate.d/zws
  fi
  command -v logrotate >/dev/null 2>&1 || fail "logrotate is required for production log rotation"
}

configure_nginx() {
  if [[ ! -f "$CANDIDATE_DIR/config/nginx/zws.conf" ]]; then return 0; fi
  log "Refreshing Nginx config"
  local target="/etc/nginx/sites-available/myrdphub" rendered
  rendered="$(mktemp)"
  export SITE_DOMAIN="${SITE_DOMAIN:-localhost}" PORT="$LIVE_PORT" ZWS_ROOT_DIR="$ROOT_DIR" VNC_PROXY_PORT="${VNC_PROXY_PORT:-3001}"
  envsubst '${SITE_DOMAIN} ${PORT} ${ZWS_ROOT_DIR} ${VNC_PROXY_PORT}' <"$CANDIDATE_DIR/config/nginx/zws.conf" >"$rendered"
  if [[ -f "/etc/letsencrypt/live/$SITE_DOMAIN/fullchain.pem" ]]; then
    grep -Eq 'listen[[:space:]]+443[[:space:]]+ssl' "$rendered" || fail "Rendered nginx config is missing listen 443 ssl"
    grep -Fq "/etc/letsencrypt/live/$SITE_DOMAIN/fullchain.pem" "$rendered" || fail "Rendered nginx config is missing SSL certificate path"
    grep -Fq "/etc/letsencrypt/live/$SITE_DOMAIN/privkey.pem" "$rendered" || fail "Rendered nginx config is missing SSL certificate key path"
  fi
  cp "$rendered" "$target"
  rm -f "$rendered"
  ln -sfn "$target" /etc/nginx/sites-enabled/myrdphub
  rm -f /etc/nginx/sites-enabled/yatycloud /etc/nginx/sites-enabled/zws /etc/nginx/sites-enabled/default
  nginx -t
  systemctl reload nginx
}

cleanup_invalid_pm2() {
  log "Cleaning legacy PM2 apps"
  pm2 delete "${LEGACY_PM2_APPS[@]}" >/dev/null 2>&1 || true
}

cleanup_duplicate_cron() {
  log "Cleaning duplicate legacy cron entries"
  if crontab -l >/tmp/zws-crontab.$$ 2>/dev/null; then
    grep -vE '(zws|/var/www/zws|provision-worker|node-telemetry-worker|vm-telemetry-worker|live-bandwidth-worker)' /tmp/zws-crontab.$$ | crontab - || true
  fi
  rm -f /tmp/zws-crontab.$$
}

build_candidate() {
  log "Installing dependencies and building candidate"
  cleanup_build_cache
  (cd "$CANDIDATE_DIR" && pnpm install --frozen-lockfile)
  (cd "$CANDIDATE_DIR" && pnpm exec prisma generate)
  (cd "$CANDIDATE_DIR" && pnpm exec prisma validate)
  (cd "$CANDIDATE_DIR" && pnpm exec prisma migrate deploy)
  (cd "$CANDIDATE_DIR" && pnpm db:validate:migrations)
  (cd "$CANDIDATE_DIR" && pnpm seed:install-baseline)
  (cd "$CANDIDATE_DIR" && pnpm seed:whatsapp-templates)
  (cd "$CANDIDATE_DIR" && pnpm repair:production-state)
  check_worker_entrypoints "$CANDIDATE_DIR"
  (cd "$CANDIDATE_DIR" && pnpm typecheck)
  (cd "$CANDIDATE_DIR" && pnpm lint)
  run_production_tests
  (cd "$CANDIDATE_DIR" && pnpm build)
}

smoke_candidate() {
  start_candidate
  check_url "http://127.0.0.1:$CANDIDATE_PORT/health" "Candidate app"
  check_url "http://127.0.0.1:$CANDIDATE_PORT/api/runtime/config" "Candidate API"
  check_candidate_route_smoke "$CANDIDATE_PORT"
  cleanup_candidate
  CANDIDATE_PID=""
}

promote_candidate() {
  log "Activating single codebase at $ROOT_DIR"
  rsync -a --delete \
    --exclude '/.git' --exclude '/shared' --exclude '/uploads' --exclude '/logs' \
    --exclude '/current' --exclude '/releases' \
    "$CANDIDATE_DIR/" "$ROOT_DIR/"
  ln -sfn "$ENV_FILE" "$ROOT_DIR/.env"
  ln -sfn "$LOG_DIR" "$ROOT_DIR/logs"
  ln -sfn "$SHARED_DIR/uploads" "$ROOT_DIR/uploads"
  SWITCHED_RELEASE="1"
}

restart_pm2() {
  cleanup_invalid_pm2
  pm2 startOrReload "$ROOT_DIR/ecosystem.config.js" --update-env
  pm2 save
}

cleanup_candidate_tree() {
  rm -rf "$CANDIDATE_DIR"
  rm -f "$ROOT_DIR/current"
  rm -rf "$ROOT_DIR/releases"
}

main() {
  require_root
  init_logging
  log "Starting production update"
  log "Repository: ${REPO_URL:-$DEFAULT_REPO_URL}"
  log "Updater version: $APP_VERSION"
  prepare_layout
  ensure_env_defaults
  backup_current
  sync_source_tree
  local repo
  repo="$(resolve_repo_url)"
  log "Using repository: $repo"
  create_candidate "$repo"
  log "Candidate version: $(read_version "$CANDIDATE_DIR")"
  build_candidate
  smoke_candidate
  configure_logrotate
  configure_nginx
  cleanup_duplicate_cron
  promote_candidate
  restart_pm2
  check_live_health
  cleanup_candidate_tree
  trap - ERR
  log "Update complete: $ROOT_DIR"
  log "Repository: $repo"
  log "Version: $(read_version "$ROOT_DIR")"
}

main "$@"
