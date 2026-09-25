#!/usr/bin/env bash
set -Eeuo pipefail

ZWS_DB_USER="${ZWS_DB_USER:-zwscloud_app}"
ZWS_DB_PASSWORD="${ZWS_DB_PASSWORD:-}"
ZWS_DB_NAMES="${ZWS_DB_NAMES:-zwscloud zwscloud_staging zwscloud_test}"
ZWS_PRIMARY_DB="${ZWS_PRIMARY_DB:-zwscloud}"
ZWS_BACKUP_ROOT="${ZWS_BACKUP_ROOT:-/var/backups/zws-postgres}"
ZWS_WAL_ARCHIVE_DIR="${ZWS_WAL_ARCHIVE_DIR:-/var/lib/postgresql/wal-archive}"
ZWS_CLOUDFLARED_TUNNEL_NAME="${ZWS_CLOUDFLARED_TUNNEL_NAME:-zws-db-private}"
ZWS_DB_HOSTNAME="${ZWS_DB_HOSTNAME:-db.myrdphub.com}"
ZWS_PGBACKREST_REPO="${ZWS_PGBACKREST_REPO:-/var/lib/pgbackrest}"
ZWS_PGBACKREST_LOG_DIR="${ZWS_PGBACKREST_LOG_DIR:-/var/log/pgbackrest}"
ZWS_PGBOUNCER_PORT="${ZWS_PGBOUNCER_PORT:-6432}"

log() { printf '[zws-db-setup] %s\n' "$*"; }
fail() { printf '[zws-db-setup] ERROR: %s\n' "$*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || fail "Run as root"
[[ -n "$ZWS_DB_PASSWORD" ]] || fail "Set ZWS_DB_PASSWORD before running"

install_packages() {
  log "Installing PostgreSQL 17 and support packages"
  apt-get update
  apt-get install -y ca-certificates curl gnupg lsb-release ufw logrotate gzip jq
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor >/etc/apt/keyrings/postgresql.gpg
  echo "deb [signed-by=/etc/apt/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" >/etc/apt/sources.list.d/pgdg.list
  apt-get update
  apt-get install -y postgresql-17 postgresql-client-17 postgresql-contrib-17 pgbouncer pgbackrest fail2ban prometheus-node-exporter
  if ! command -v cloudflared >/dev/null 2>&1; then
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | gpg --dearmor >/usr/share/keyrings/cloudflare-main.gpg
    echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" >/etc/apt/sources.list.d/cloudflared.list
    apt-get update
    apt-get install -y cloudflared
  fi
  if command -v cloudflared >/dev/null 2>&1 && [[ "$(command -v cloudflared)" != "/usr/bin/cloudflared" ]]; then
    ln -sf "$(command -v cloudflared)" /usr/bin/cloudflared || true
  fi
}

configure_postgres() {
  log "Hardening PostgreSQL 17 for private localhost access"
  install -d -o postgres -g postgres -m 0700 "$ZWS_WAL_ARCHIVE_DIR" "$ZWS_BACKUP_ROOT"/{daily,weekly,monthly,restore-tests} "$ZWS_PGBACKREST_REPO" "$ZWS_PGBACKREST_LOG_DIR"
  local conf="/etc/postgresql/17/main/postgresql.conf"
  local hba="/etc/postgresql/17/main/pg_hba.conf"
  sed -i "s/^#\\?listen_addresses.*/listen_addresses = '127.0.0.1'/" "$conf"
  grep -q '^wal_level = replica' "$conf" || cat >>"$conf" <<EOF

# ZWS production clone durability
wal_level = replica
archive_mode = on
archive_command = 'pgbackrest --stanza=zws archive-push %p'
archive_timeout = 300
max_wal_senders = 5
wal_keep_size = 2048MB
EOF
  cat >"$hba" <<'EOF'
local   all             postgres                                peer
local   all             all                                     peer
host    all             all             127.0.0.1/32            scram-sha-256
host    all             all             ::1/128                 scram-sha-256
EOF
  systemctl enable --now postgresql
  systemctl restart postgresql
}

configure_pgbouncer() {
  log "Configuring pgBouncer on 127.0.0.1:${ZWS_PGBOUNCER_PORT}"
  local userlist="/etc/pgbouncer/userlist.txt"
  local encoded
  encoded="$(runuser -u postgres -- psql -v ON_ERROR_STOP=1 --set=db_user="$ZWS_DB_USER" -tAc "SELECT rolpassword FROM pg_authid WHERE rolname = :'db_user'" 2>/dev/null | tr -d '[:space:]' || true)"
  if [[ -z "$encoded" ]]; then
    encoded="$ZWS_DB_PASSWORD"
  fi
  cat >"$userlist" <<EOF
"$ZWS_DB_USER" "$encoded"
EOF
  chmod 0600 "$userlist"
  chown postgres:postgres "$userlist"
  cat >/etc/pgbouncer/pgbouncer.ini <<EOF
[databases]
* = host=127.0.0.1 port=5432

[pgbouncer]
listen_addr = 127.0.0.1
listen_port = ${ZWS_PGBOUNCER_PORT}
auth_type = scram-sha-256
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = transaction
max_client_conn = 300
default_pool_size = 30
reserve_pool_size = 10
ignore_startup_parameters = extra_float_digits
server_tls_sslmode = disable
client_tls_sslmode = disable
admin_users = postgres
stats_users = postgres
EOF
  systemctl enable --now pgbouncer
  systemctl restart pgbouncer
}

configure_pgbackrest() {
  log "Configuring pgBackRest stanza zws"
  cat >/etc/pgbackrest.conf <<EOF
[global]
repo1-path=${ZWS_PGBACKREST_REPO}
repo1-retention-full=4
repo1-retention-diff=8
repo1-bundle=y
repo1-block=y
start-fast=y
process-max=2
log-level-console=info
log-level-file=detail
log-path=${ZWS_PGBACKREST_LOG_DIR}

[zws]
pg1-path=/var/lib/postgresql/17/main
pg1-port=5432
EOF
  chown postgres:postgres /etc/pgbackrest.conf
  chmod 0640 /etc/pgbackrest.conf
  runuser -u postgres -- pgbackrest --stanza=zws stanza-create || true
  runuser -u postgres -- pgbackrest --stanza=zws check
}

create_databases() {
  log "Creating ZWS role and databases"
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 --set=db_user="$ZWS_DB_USER" --set=db_password="$ZWS_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'db_user', :'db_password')
WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = :'db_user')\gexec
SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', :'db_user', :'db_password')\gexec
SQL
  local db
  for db in $ZWS_DB_NAMES; do
    runuser -u postgres -- psql -v ON_ERROR_STOP=1 --set=db="$db" --set=db_user="$ZWS_DB_USER" <<'SQL'
SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'db_user')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'db')\gexec
SELECT format('GRANT ALL PRIVILEGES ON DATABASE %I TO %I', :'db', :'db_user')\gexec
SQL
  done
}

install_backup_tools() {
  log "Installing backup and restore-test jobs"
  cat >/usr/local/sbin/zws-pg-backup <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
scope="${1:-daily}"
db="${2:-zwscloud}"
type="${3:-incr}"
root="${ZWS_BACKUP_ROOT:-/var/backups/zws-postgres}"
ts="$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "$root/$scope"
out="$root/$scope/${db}-${ts}.dump"
pg_dump -U postgres -Fc "$db" -f "$out"
sha256sum "$out" >"$out.sha256"
pgbackrest --stanza=zws --type="$type" backup
find "$root/daily" -type f -mtime +14 -delete 2>/dev/null || true
find "$root/weekly" -type f -mtime +60 -delete 2>/dev/null || true
find "$root/monthly" -type f -mtime +370 -delete 2>/dev/null || true
printf '%s\n' "$out"
EOF
  cat >/usr/local/sbin/zws-create-database <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
db="${1:?database name required}"
owner="${2:-zwscloud_app}"
runuser -u postgres -- psql -v ON_ERROR_STOP=1 --set=db="$db" --set=db_user="$owner" <<'SQL'
SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'db_user')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'db')\gexec
SELECT format('GRANT ALL PRIVILEGES ON DATABASE %I TO %I', :'db', :'db_user')\gexec
SQL
EOF
  cat >/usr/local/sbin/zws-pgbackrest-restore-validate <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
root="${ZWS_BACKUP_ROOT:-/var/backups/zws-postgres}"
restore_dir="$(mktemp -d /var/tmp/zws-pgbackrest-restore-XXXXXX)"
trap 'rm -rf "$restore_dir"' EXIT
pgbackrest --stanza=zws check
pgbackrest --stanza=zws --pg1-path="$restore_dir" restore
test -f "$restore_dir/PG_VERSION"
mkdir -p "$root/restore-tests"
printf '[%s] PASS pgBackRest restore files -> %s\n' "$(date -u +%FT%TZ)" "$restore_dir" >>"$root/restore-tests/history.log"
EOF
  cat >/usr/local/sbin/zws-pg-restore-test <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
artifact="${1:?backup artifact required}"
root="${ZWS_BACKUP_ROOT:-/var/backups/zws-postgres}"
db="zws_restore_test_$(date -u +%Y%m%d%H%M%S)"
createdb -U postgres "$db"
trap 'dropdb -U postgres --if-exists "$db" >/dev/null 2>&1 || true' EXIT
pg_restore -U postgres --no-owner --no-privileges -d "$db" "$artifact"
psql -U postgres -d "$db" -tAc 'SELECT count(*) FROM information_schema.tables WHERE table_schema = $$public$$;'
mkdir -p "$root/restore-tests"
printf '[%s] PASS %s -> %s\n' "$(date -u +%FT%TZ)" "$artifact" "$db" >>"$root/restore-tests/history.log"
EOF
  chown postgres:postgres /usr/local/sbin/zws-pg-backup /usr/local/sbin/zws-pg-restore-test /usr/local/sbin/zws-pgbackrest-restore-validate
  chmod 0750 /usr/local/sbin/zws-pg-backup /usr/local/sbin/zws-pg-restore-test /usr/local/sbin/zws-pgbackrest-restore-validate
  chmod 0755 /usr/local/sbin/zws-create-database
  cat >/etc/cron.d/zws-postgres-backups <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
15 1 * * * postgres /usr/local/sbin/zws-pg-backup daily ${ZWS_PRIMARY_DB} incr >/var/log/zws-pg-backup.log 2>&1
30 2 * * 0 postgres /usr/local/sbin/zws-pg-backup weekly ${ZWS_PRIMARY_DB} diff >/var/log/zws-pg-backup-weekly.log 2>&1
45 3 1 * * postgres /usr/local/sbin/zws-pg-backup monthly ${ZWS_PRIMARY_DB} full >/var/log/zws-pg-backup-monthly.log 2>&1
15 4 * * 0 postgres /usr/local/sbin/zws-pgbackrest-restore-validate >/var/log/zws-pgbackrest-restore-validate.log 2>&1
EOF
}

configure_firewall() {
  log "Configuring firewall: SSH allowed, Postgres not public"
  ufw allow OpenSSH || true
  ufw deny 5432/tcp || true
  ufw --force enable || true
}

write_cloudflared_template() {
  log "Writing Cloudflare DB tunnel template"
  install -d -m 0700 /root/.cloudflared
  local tunnel_id=""
  if command -v cloudflared >/dev/null 2>&1 && [[ -f /root/.cloudflared/cert.pem ]]; then
    tunnel_id="$(cloudflared tunnel list --output json 2>/dev/null | jq -r --arg name "$ZWS_CLOUDFLARED_TUNNEL_NAME" '.[] | select(.name == $name) | .id' | head -n 1)"
    if [[ -z "$tunnel_id" ]]; then
      cloudflared tunnel create "$ZWS_CLOUDFLARED_TUNNEL_NAME" >/tmp/zws-cloudflared-create.log
      tunnel_id="$(cloudflared tunnel list --output json 2>/dev/null | jq -r --arg name "$ZWS_CLOUDFLARED_TUNNEL_NAME" '.[] | select(.name == $name) | .id' | head -n 1)"
    fi
    [[ -n "$tunnel_id" ]] && cloudflared tunnel route dns "$ZWS_CLOUDFLARED_TUNNEL_NAME" "$ZWS_DB_HOSTNAME" || true
  fi
  local credentials="/root/.cloudflared/<TUNNEL-UUID>.json"
  [[ -n "$tunnel_id" ]] && credentials="/root/.cloudflared/${tunnel_id}.json"
  cat >/root/.cloudflared/zws-db-config.yml.example <<EOF
tunnel: ${tunnel_id:-<TUNNEL-UUID>}
credentials-file: ${credentials}

ingress:
  - hostname: ${ZWS_DB_HOSTNAME}
    service: tcp://127.0.0.1:${ZWS_PGBOUNCER_PORT}
  - service: http_status:404
EOF
  if [[ -n "$tunnel_id" ]]; then
    cp /root/.cloudflared/zws-db-config.yml.example /root/.cloudflared/config.yml
  fi
  cat >/etc/systemd/system/zws-db-tunnel.service <<EOF
[Unit]
Description=ZWS private PostgreSQL Cloudflare Tunnel
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/cloudflared tunnel --config /root/.cloudflared/config.yml run ${ZWS_CLOUDFLARED_TUNNEL_NAME}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
}

install_packages
configure_postgres
create_databases
configure_pgbouncer
configure_pgbackrest
install_backup_tools
configure_firewall
write_cloudflared_template
log "Database server prepared. If /root/.cloudflared/config.yml exists, enable zws-db-tunnel.service."
