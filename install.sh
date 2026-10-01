#!/usr/bin/env bash
set -Eeuo pipefail

# ZWS Cloud Panel - Direct Installer Bootstrap
# Downloads the direct installer from production server
# No GitHub, no git clone

INSTALL_URL="https://zwscloud.com/api/install/direct"

log() { printf '[zws-install] %s\n' "$*"; }
fail() { printf '[zws-install] ERROR: %s\n' "$*" >&2; exit 1; }

# Download and execute the direct installer
curl -fsSL "$INSTALL_URL" | sudo bash -s -- "$@"