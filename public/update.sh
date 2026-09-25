#!/usr/bin/env bash
set -Eeuo pipefail

BASE_URL="${ZWS_INSTALL_BASE_URL:-https://myrdphub.com}"
SCRIPT_URL="${UPDATE_SCRIPT_URL:-$BASE_URL/update-source.sh}"

tmp_script="$(mktemp)"
cleanup() { rm -f "$tmp_script"; }
trap cleanup EXIT

curl -fsSL "$SCRIPT_URL" -o "$tmp_script"
chmod +x "$tmp_script"
exec bash "$tmp_script" "$@"
