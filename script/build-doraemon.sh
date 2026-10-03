#!/usr/bin/env bash
# Build the independently selectable Doraemon port from the default frontend.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
for required in node corepack rsync; do
  command -v "$required" >/dev/null || { echo "Missing Doraemon build dependency: $required" >&2; exit 1; }
done
(cd "$root/frontend/user" && corepack pnpm install --frozen-lockfile && corepack pnpm run build:doraemon)
[[ -s "$root/frontend/user/dist-doraemon/index.html" ]]
mkdir -p "$root/cmd/dashboard/doraemon-dist"
rsync -a --delete "$root/frontend/user/dist-doraemon/" "$root/cmd/dashboard/doraemon-dist/"
echo "Doraemon frontend embedded: cmd/dashboard/doraemon-dist"
