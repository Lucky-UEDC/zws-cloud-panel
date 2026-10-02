#!/usr/bin/env bash
set -Eeuo pipefail

# Create a release archive for the installer

VERSION="${1:-$(cat package.json | grep '"version"' | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')}"
RELEASE_DIR="/tmp/zws-cloud-panel-${VERSION}"
ARCHIVE_NAME="zws-cloud-panel-${VERSION}.tar.gz"
ARCHIVE_PATH="/var/www/myrdphub/public/releases/${ARCHIVE_NAME}"
SHA256_PATH="/var/www/myrdphub/public/releases/${ARCHIVE_NAME}.sha256"

echo "Creating release ${VERSION}..."

# Clean up
rm -rf "${RELEASE_DIR}"
mkdir -p "${RELEASE_DIR}"

# Copy required files for deployment.
#
# Every directory exclusion below is anchored with a leading "/". An unanchored
# rsync exclude matches at ANY depth, which silently strips real source
# directories that happen to share the name (app/admin/backups,
# app/api/admin/logs, app/uploads, ...) and produces a release that builds
# against an incomplete route tree.
echo "Copying files..."
rsync -av \
  --exclude '/node_modules' \
  --exclude '/.git' \
  --exclude '/.next' \
  --exclude '/.pnpm-store' \
  --exclude '/.next-static-previous' \
  --exclude '/.github' \
  --exclude '/.turbo' \
  --exclude '/.vercel' \
  --exclude '/coverage' \
  --exclude '/.nyc_output' \
  --exclude '*.log' \
  --exclude '*.tsbuildinfo' \
  --exclude '.DS_Store' \
  --exclude '*.pem' \
  --exclude '*.key' \
  --exclude '*.crt' \
  --exclude '/.env*' \
  --exclude '!/.env.example' \
  --exclude '*.sqlite' \
  --exclude '*.db' \
  --exclude '*.sqlite3' \
  --exclude '/.vscode' \
  --exclude '/.idea' \
  --exclude '*.swp' \
  --exclude '*.swo' \
  --exclude '*.tmp' \
  --exclude '*.temp' \
  --exclude '/public/releases' \
  --exclude '/releases' \
  --exclude '/certs' \
  --exclude '/acme-webroot' \
  --exclude '/logs' \
  --exclude '/backups' \
  --exclude '/reports' \
  --exclude '/uploads' \
  --exclude '/deployment-reports' \
  --exclude '/screenshots' \
  --exclude '/test-results' \
  --exclude '/playwright-report' \
  /var/www/myrdphub/ "${RELEASE_DIR}/"

# Fail loudly if any source route directory was dropped from the archive.
# These names collide with the root-level runtime directories we exclude.
echo "Verifying route tree..."
missing=0
while read -r dir; do
  rel="${dir#./}"
  if [[ ! -d "${RELEASE_DIR}/${rel}" ]]; then
    echo "  MISSING FROM RELEASE: ${rel}" >&2
    missing=1
  fi
done < <(find ./app -type d \( -name backups -o -name logs -o -name reports -o -name uploads -o -name deployment-reports \) -print | sort)
[[ $missing -eq 0 ]] || { echo "Release is missing route directories; aborting." >&2; exit 1; }

# Create VERSION file
echo "${VERSION}" > "${RELEASE_DIR}/VERSION"

# Create commit info
cd /var/www/myrdphub
git rev-parse HEAD > "${RELEASE_DIR}/COMMIT"
git log -1 --format="%ci" > "${RELEASE_DIR}/BUILD_DATE"

# Create archive
echo "Creating archive..."
mkdir -p /var/www/myrdphub/public/releases
cd /tmp
tar -czf "${ARCHIVE_PATH}" -C /tmp "zws-cloud-panel-${VERSION}"

# Generate SHA256
sha256sum "${ARCHIVE_PATH}" | awk '{print $1}' > "${SHA256_PATH}"

# Prune superseded archives so public/releases stays small and the
# release endpoint does not have to scan hundreds of megabytes.
echo "Pruning old releases..."
cd /var/www/myrdphub/public/releases
ls -1t zws-cloud-panel-*.tar.gz 2>/dev/null | tail -n +3 | while read -r old; do
  echo "  removing ${old}"
  rm -f "${old}" "${old}.sha256"
done

# Refresh the "latest" symlinks consumed by the installer endpoints.
ln -sfn "${ARCHIVE_NAME}" zws-cloud-panel-latest.tar.gz
ln -sfn "${ARCHIVE_NAME}.sha256" zws-cloud-panel-latest.tar.gz.sha256

echo "Release created:"
echo "  Archive: ${ARCHIVE_PATH}"
echo "  SHA256:  $(cat ${SHA256_PATH})"
echo "  Size:    $(du -h ${ARCHIVE_PATH} | cut -f1)"
