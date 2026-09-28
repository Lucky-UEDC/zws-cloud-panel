#!/usr/bin/env bash
# Run a command from package.json inside the toolchain container.
# The host has no node/pnpm (Docker-first repo), so all build/test tooling
# runs through this wrapper with the source tree bind-mounted.
set -euo pipefail
cd "$(dirname "$0")/.."
exec docker run --rm \
  -v "$PWD:/app" \
  -v zws-pnpm-store:/pnpm-store \
  -w /app \
  -e CI=1 \
  -e NEXT_TELEMETRY_DISABLED=1 \
  -e NODE_OPTIONS="--no-deprecation" \
  node:22-bookworm \
  sh -lc "corepack enable >/dev/null 2>&1; exec pnpm $*"
