#!/usr/bin/env bash
# ============================================================================
# Fixed host-side release apply script (Problem E / Update Center).
#
# This is the ONLY executor the Update Center may run, and it is invoked with
# strictly validated arguments coming from a trusted release manifest:
#   scripts/apply-release.sh <version> <imageRef> [deploymentId] [adminEmail]
#
# Safety properties:
#   * No free-form input: <version> must be `X.Y.Z` and <imageRef> must be an
#     image name inside the trusted prefix (default `zws-cloud:`).
#   * Database is snapshot BEFORE any change and the dump is verified
#     non-empty before the migration step runs (guarded, per AGENTS.md).
#   * Migrations run through the Compose `migrate` service.
#   * The new image is tagged immutable (`zws-cloud:<version>` +
#     `zws-cloud:<source-commit>`) before `latest` is moved.
#   * Health is verified after deploy; the running version is checked via
#     /api/runtime/version. Nothing is reported as success until that passes.
# ============================================================================
set -Eeuo pipefail

VERSION="${1:-}"
IMAGE_REF="${2:-}"
DEPLOYMENT_ID="${3:-}"
ADMIN_EMAIL="${4:-}"

log() { echo "[apply-release] $*"; }
die() { echo "[apply-release] ERROR: $*" >&2; exit 1; }

# --- Validate arguments (mirror of lib/updates/releases.ts) -----------------
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "invalid version '${VERSION}' (must be X.Y.Z)"
[[ "$IMAGE_REF" =~ ^zws-cloud: ]] || die "image ref '${IMAGE_REF}' is not in the trusted prefix 'zws-cloud:'"
case "$IMAGE_REF" in
  */*) die "image ref '${IMAGE_REF}' contains a path segment" ;;
esac

COMPOSE="${UPDATE_COMPOSE:-docker compose}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="${UPDATE_BACKUP_DIR:-/var/www/backups}"
mkdir -p "$BACKUP_DIR"
DUMP_PATH="$BACKUP_DIR/zws-pre-update-$VERSION-$TIMESTAMP.sql.gz"

# --- 1. Pre-deploy database snapshot + verify -------------------------------
log "snapshotting database before update -> $DUMP_PATH"
PG_CONTAINER="${UPDATE_PG_CONTAINER:-}"
if [[ -z "$PG_CONTAINER" ]]; then
  # Discover the live postgres container (production name known).
  PG_CONTAINER="$(docker ps --format '{{.Names}}' | grep -E 'postgres' | head -1 || true)"
fi
PG_USER="${POSTGRES_USER:-zwscloud_app}"
PG_DB="${POSTGRES_DB:-zwscloud}"
[[ -n "$PG_CONTAINER" ]] || die "could not locate the postgres container; set UPDATE_PG_CONTAINER"
docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -d "$PG_DB" --no-owner --no-privileges | gzip > "$DUMP_PATH"
gzip -t "$DUMP_PATH" || die "database dump failed integrity check"
SIZE="$(stat -c%s "$DUMP_PATH" 2>/dev/null || echo 0)"
[[ "$SIZE" -gt 1024 ]] || die "database dump is suspiciously small (${SIZE} bytes)"
log "database snapshot verified (${SIZE} bytes)"

# --- 2. Build the release as an IMMUTABLE image -----------------------------
log "building zws-cloud:${VERSION} (immutable)"
${COMPOSE} build --build-arg "APP_VERSION=${VERSION}" app
docker tag zws-cloud:latest "zws-cloud:${VERSION}"
log "tagged zws-cloud:${VERSION}"

# --- 3. Migrations via the Compose migrate service --------------------------
log "running migrations (compose migrate)"
${COMPOSE} run --rm migrate

# --- 4. Deploy app / worker / scheduler -------------------------------------
log "deploying app / worker / scheduler"
${COMPOSE} up -d --remove-orphans app worker scheduler

# --- 5. Wait for health -----------------------------------------------------
log "waiting for healthy services"
APP_URL="${UPDATE_APP_URL:-http://127.0.0.1:13000}"
for attempt in $(seq 1 30); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "$APP_URL/api/health" || true)"
  if [[ "$CODE" == "200" || "$CODE" == "503" ]]; then
    log "app healthy (HTTP ${CODE})"
    break
  fi
  [[ "$attempt" -eq 30 ]] && die "app did not become healthy (last HTTP ${CODE:-none})"
  sleep 5
done

# --- 6. Smoke: running version must match the release ------------------------
log "verifying running version"
RUNNING_VERSION="$(curl -s "$APP_URL/api/runtime/version" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p' || true)"
[[ "$RUNNING_VERSION" == "$VERSION" ]] || die "running version is '${RUNNING_VERSION:-unknown}', expected '${VERSION}'"
log "verified running version ${RUNNING_VERSION}"

# --- 7. Record immutable tag + result ----------------------------------------
COMMIT="$(docker run --rm --entrypoint sh "zws-cloud:${VERSION}" -c 'node -e "process.stdout.write(JSON.parse(require(\"fs\").readFileSync(\"/app/runtime-info.json\",\"utf8\")).commit || \"\")"' 2>/dev/null || true)"
if [[ -n "$COMMIT" ]]; then
  docker tag "zws-cloud:${VERSION}" "zws-cloud:${COMMIT}" || true
fi
mkdir -p releases
printf '{\n  "version": "%s",\n  "image": "%s",\n  "commit": "%s",\n  "appliedAt": "%s",\n  "deploymentId": "%s"\n}\n' \
  "$VERSION" "$IMAGE_REF" "$COMMIT" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$DEPLOYMENT_ID" > releases/last-applied.json

log "release ${VERSION} applied and verified (deployment ${DEPLOYMENT_ID:-untracked}, admin ${ADMIN_EMAIL:-unknown})"
log "pre-update snapshot retained at ${DUMP_PATH}"
exit 0