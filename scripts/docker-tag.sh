#!/usr/bin/env bash
# ============================================================================
# Immutable image tagging helper (operator-run, after `docker compose build`).
#
# Production deploys use IMMUTABLE images (Part 33): every release gets a
# stable `zws-cloud:<version>` tag plus a `zws-cloud:<source-commit>` tag, and
# the digest is recorded into releases/ so downstream tooling (Update Center)
# can verify exactly what is running before applying anything.
#
# Usage:
#   scripts/docker-tag.sh [version] [image]
#     version  defaults to package.json version (1.1.0)
#     image    defaults to zws-cloud
#
# Required after build: `docker compose build` (or the equivalent build).
# ============================================================================
set -Eeuo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:-$(awk -F'"' '/"version"/ {print $4; exit}' package.json)}"
IMAGE="${IMAGE:-zws-cloud}"
COMMIT=""

# Prefer an explicit APP_COMMIT env (CI provides this); otherwise read the
# source fingerprint baked into the runtime-info.json of the freshly built image.
if [[ -n "${APP_COMMIT:-}" ]]; then
  COMMIT="${APP_COMMIT}"
else
  COMMIT="$(docker run --rm --entrypoint sh "${IMAGE}:latest" -c 'node -e "process.stdout.write(JSON.parse(require(\"fs\").readFileSync(\"/app/runtime-info.json\",\"utf8\")).commit || \"\")"' 2>/dev/null || echo "")"
fi

echo "[docker-tag] tagging immutable images for ${IMAGE}"
docker tag "${IMAGE}:latest" "${IMAGE}:${VERSION}"
echo "[docker-tag]   ${IMAGE}:${VERSION}"
if [[ -n "${COMMIT}" ]]; then
  docker tag "${IMAGE}:latest" "${IMAGE}:${COMMIT}"
  echo "[docker-tag]   ${IMAGE}:${COMMIT}"
fi

DIGEST="$(docker inspect --format='{{index .RepoDigests 0}}' "${IMAGE}:${VERSION}" 2>/dev/null || echo "")"
mkdir -p releases
{
  printf '{\n'
  printf '  "version": "%s",\n' "${VERSION}"
  printf '  "commit": "%s",\n' "${COMMIT}"
  printf '  "digest": "%s",\n' "${DIGEST}"
  printf '  "taggedAt": "%s"\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '}\n'
} > releases/last-release.json

echo "[docker-tag] digest: ${DIGEST:-unavailable}"
echo "[docker-tag] written releases/last-release.json"