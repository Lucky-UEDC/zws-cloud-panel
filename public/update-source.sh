#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="${ZWS_REPO_URL:-https://github.com/samvpslio/myrdphub-platform.git}"
BRANCH="${ZWS_BRANCH:-main}"

tmp_dir="$(mktemp -d)"
cleanup() { rm -rf "$tmp_dir"; }
trap cleanup EXIT

if ! command -v git >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y git ca-certificates curl
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y git ca-certificates curl
  elif command -v yum >/dev/null 2>&1; then
    yum install -y git ca-certificates curl
  else
    printf '[zws-update] ERROR: git is required and no supported package manager was found\n' >&2
    exit 1
  fi
fi

git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$tmp_dir/myrdphub-platform"
exec bash "$tmp_dir/myrdphub-platform/update.sh" "$@"
