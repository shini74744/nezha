#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
(cd "$root/frontend/user" && corepack pnpm install --frozen-lockfile && corepack pnpm run build:paper)
test -s "$root/frontend/user/dist-paper/index.html"
mkdir -p "$root/cmd/dashboard/paper-dist"
rsync -a --delete "$root/frontend/user/dist-paper/" "$root/cmd/dashboard/paper-dist/"
echo "Paper frontend embedded: cmd/dashboard/paper-dist"
