#!/usr/bin/env bash
set -Eeuo pipefail

ZWS_DB_HOSTNAME="${ZWS_DB_HOSTNAME:-db.myrdphub.com}"
ZWS_LOCAL_DB_HOST="${ZWS_LOCAL_DB_HOST:-127.0.0.1}"
ZWS_LOCAL_DB_PORT="${ZWS_LOCAL_DB_PORT:-15432}"
ZWS_SERVICE_USER="${ZWS_SERVICE_USER:-root}"
ZWS_ACCESS_TOKEN_ID="${ZWS_ACCESS_TOKEN_ID:-${TUNNEL_SERVICE_TOKEN_ID:-}}"
ZWS_ACCESS_TOKEN_SECRET="${ZWS_ACCESS_TOKEN_SECRET:-${TUNNEL_SERVICE_TOKEN_SECRET:-}}"

log() { printf '[zws-app-db-tunnel] %s\n' "$*"; }
fail() { printf '[zws-app-db-tunnel] ERROR: %s\n' "$*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || fail "Run as root"

install_cloudflared() {
  if command -v cloudflared >/dev/null 2>&1; then return; fi
  apt-get update
  apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | gpg --dearmor >/usr/share/keyrings/cloudflare-main.gpg
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" >/etc/apt/sources.list.d/cloudflared.list
  apt-get update
  apt-get install -y cloudflared
}

normalize_cloudflared_path() {
  if command -v cloudflared >/dev/null 2>&1 && [[ "$(command -v cloudflared)" != "/usr/bin/cloudflared" ]]; then
    ln -sf "$(command -v cloudflared)" /usr/bin/cloudflared || true
  fi
}

install_service() {
  log "Installing app-side Cloudflare Access TCP client"
  local exec_start="/usr/bin/cloudflared access tcp --hostname ${ZWS_DB_HOSTNAME} --url ${ZWS_LOCAL_DB_HOST}:${ZWS_LOCAL_DB_PORT}"
  if [[ -n "$ZWS_ACCESS_TOKEN_ID" && -n "$ZWS_ACCESS_TOKEN_SECRET" ]]; then
    install -d -m 0700 /etc/zws
    cat >/etc/zws/db-access.env <<EOF
TUNNEL_SERVICE_TOKEN_ID=${ZWS_ACCESS_TOKEN_ID}
TUNNEL_SERVICE_TOKEN_SECRET=${ZWS_ACCESS_TOKEN_SECRET}
EOF
    chmod 0600 /etc/zws/db-access.env
  fi
  cat >/etc/systemd/system/zws-db-access.service <<EOF
[Unit]
Description=ZWS app PostgreSQL Cloudflare Access TCP client
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${ZWS_SERVICE_USER}
$(if [[ -n "$ZWS_ACCESS_TOKEN_ID" && -n "$ZWS_ACCESS_TOKEN_SECRET" ]]; then printf 'EnvironmentFile=/etc/zws/db-access.env\n'; fi)
ExecStart=${exec_start}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now zws-db-access
}

install_cloudflared
normalize_cloudflared_path
install_service
log "Tunnel client listening on ${ZWS_LOCAL_DB_HOST}:${ZWS_LOCAL_DB_PORT}. Use DB_HOST=${ZWS_LOCAL_DB_HOST}, DB_PORT=${ZWS_LOCAL_DB_PORT}, DB_DATABASE=zwscloud."
