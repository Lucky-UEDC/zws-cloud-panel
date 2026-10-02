#!/usr/bin/env bash
# Sync the Let's Encrypt certificate for a site into the directory the Docker
# nginx container reads from, then reload that container.
#
# Installed as the certbot renew/deploy hook for the Docker-first nginx
# deployment. It replaces the old `systemctl reload nginx` hook, which no longer
# works because nginx runs in a container rather than under systemd.
#
# Usage: sync-nginx-cert.sh [domain]
set -euo pipefail

DOMAIN="${1:-${SITE_DOMAIN:-zwscloud.com}}"
ZWS_ROOT_DIR="${ZWS_ROOT_DIR:-/var/www/myrdphub}"
CERT_DIR="${SSL_CERT_DIR:-${ZWS_ROOT_DIR}/certs}"
LE_LIVE="/etc/letsencrypt/live/${DOMAIN}"
LOG_TAG="sync-nginx-cert"

log() { logger -t "${LOG_TAG}" "$*" || true; printf '%s %s\n' "$(date -Is)" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

[ -d "${LE_LIVE}" ] || die "no Let's Encrypt live directory at ${LE_LIVE}"

SRC_FULLCHAIN="${LE_LIVE}/fullchain.pem"
SRC_KEY="${LE_LIVE}/privkey.pem"
[ -f "${SRC_FULLCHAIN}" ] || die "missing ${SRC_FULLCHAIN}"
[ -f "${SRC_KEY}" ] || die "missing ${SRC_KEY}"

# Refuse to install a chain/key pair that does not belong together.
openssl x509 -in "${SRC_FULLCHAIN}" -noout -pubkey >/tmp/.zws_cert_pub.$$ 2>/dev/null \
  || die "cannot parse certificate ${SRC_FULLCHAIN}"
openssl pkey -in "${SRC_KEY}" -pubout >/tmp/.zws_key_pub.$$ 2>/dev/null \
  || die "cannot parse private key ${SRC_KEY}"
if ! cmp -s /tmp/.zws_cert_pub.$$ /tmp/.zws_key_pub.$$; then
  rm -f /tmp/.zws_cert_pub.$$ /tmp/.zws_key_pub.$$
  die "certificate and private key do not match for ${DOMAIN}"
fi
rm -f /tmp/.zws_cert_pub.$$ /tmp/.zws_key_pub.$$

install -d -m 755 "${CERT_DIR}"
# Resolve the live/ symlinks into real files so the container mount is stable.
install -m 644 "${SRC_FULLCHAIN}" "${CERT_DIR}/fullchain.pem"
install -m 600 "${SRC_KEY}" "${CERT_DIR}/privkey.pem"

log "installed ${DOMAIN} certificate into ${CERT_DIR} (expires $(openssl x509 -in "${CERT_DIR}/fullchain.pem" -noout -enddate | cut -d= -f2))"

# Reload the nginx container backing this site, if it is running.
CONTAINER="$(docker ps \
  --filter "label=com.docker.compose.project=$(basename "${ZWS_ROOT_DIR}")" \
  --filter "label=com.docker.compose.service=nginx" \
  --format '{{.Names}}' | head -n 1)"

if [ -z "${CONTAINER}" ]; then
  log "no running nginx container found; certificate installed but reload skipped"
  exit 0
fi

if docker exec "${CONTAINER}" nginx -t >/dev/null 2>&1; then
  docker exec "${CONTAINER}" nginx -s reload >/dev/null 2>&1 \
    && log "reloaded ${CONTAINER}" \
    || log "WARNING: reload of ${CONTAINER} failed; run 'docker compose --profile nginx restart nginx'"
else
  log "WARNING: nginx config test failed in ${CONTAINER}; not reloading"
  exit 1
fi