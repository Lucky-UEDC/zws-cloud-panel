#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="${ZWS_REPO_URL:-https://github.com/Lucky-UEDC/zws-cloud-panel.git}"
BRANCH="${ZWS_BRANCH:-main}"

export ROOT_DIR="${ROOT_DIR:-/var/www/myrdphub}"
export DOMAIN="${DOMAIN:-zwscloud.com}"
export DATABASE_MODE="${DATABASE_MODE:-external}"
export DATABASE_NAME="${DATABASE_NAME:-zwscloud}"
export DATABASE_USER="${DATABASE_USER:-zwscloud_app}"
export DATABASE_TUNNEL_HOSTNAME="${DATABASE_TUNNEL_HOSTNAME:-db.zwscloud.com}"

tmp_dir="$(mktemp -d)"
cleanup() { rm -rf "$tmp_dir"; }
trap cleanup EXIT

log() { printf '[zws-install] %s\n' "$*"; }
fail() { printf '[zws-install] ERROR: %s\n' "$*" >&2; exit 1; }

if ! command -v git >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y git ca-certificates curl jq
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y git ca-certificates curl jq
  elif command -v yum >/dev/null 2>&1; then
    yum install -y git ca-certificates curl jq
  else
    fail "git, curl, jq required and no supported package manager found"
  fi
fi

# Extract owner/repo from REPO_URL
REPO_PATH="${REPO_URL#https://github.com/}"
REPO_PATH="${REPO_PATH%.git}"

# Build API URL for releases
API_URL="https://api.github.com/repos/${REPO_PATH}/releases"
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  AUTH_HEADER="Authorization: Bearer ${GITHUB_TOKEN}"
  log "Fetching releases with authentication..."
else
  AUTH_HEADER=""
  log "Fetching releases (public access)..."
fi

# Fetch releases
releases_json=$(curl -fsSL -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" ${AUTH_HEADER:+-H "$AUTH_HEADER"} "$API_URL?per_page=20" 2>/dev/null) || fail "Failed to fetch releases from GitHub"

# Parse releases with semver tags
releases=$(echo "$releases_json" | jq -r '
  .[] 
  | select(.tag_name | test("^v?[0-9]+\\.[0-9]+\\.[0-9]+"))
  | "\(.tag_name)\t\(.published_at // "unknown")\t\(.prerelease // false)\t\(.name // "Release \(.tag_name)")"
' 2>/dev/null) || fail "Failed to parse releases"

if [[ -z "$releases" ]]; then
  fail "No valid semver releases found in repository"
fi

# Display releases
log "Available releases for ${REPO_PATH}:"
echo ""
i=1
while IFS=$'\t' read -r tag date prerelease name; do
  type="stable"
  [[ "$prerelease" == "true" ]] && type="pre-release"
  printf "  %2d) %-12s  %-10s  %s  (%s)\n" "$i" "$tag" "$type" "$name" "$date"
  i=$((i + 1))
done <<< "$releases"
echo ""

# Let user choose
while true; do
  printf '[zws-install] Select release number (or "latest" for newest): '
  read -r choice
  
  if [[ "$choice" == "latest" ]]; then
    SELECTED_TAG=$(echo "$releases" | head -1 | cut -f1)
    break
  elif [[ "$choice" =~ ^[0-9]+$ ]] && [[ "$choice" -ge 1 ]] && [[ "$choice" -le $(echo "$releases" | wc -l) ]]; then
    SELECTED_TAG=$(echo "$releases" | sed -n "${choice}p" | cut -f1)
    break
  else
    echo "Invalid selection. Enter a number or 'latest'."
  fi
done

log "Selected: $SELECTED_TAG"
BRANCH="$SELECTED_TAG"

# Build authenticated clone URL if token provided
clone_url="$REPO_URL"
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  clone_url="${REPO_URL/https:\/\/github.com\//https:\/\/${GITHUB_TOKEN}@github.com\/}"
  log "Using authenticated clone"
fi

git clone --depth 1 --branch "$BRANCH" "$clone_url" "$tmp_dir/zws-cloud-panel" || fail "Git clone failed"

exec bash "$tmp_dir/zws-cloud-panel/installer/install.sh" "$@"