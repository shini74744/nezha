#!/usr/bin/env bash
# Build this fork from the backend and both frontend source trees in this repo.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$root"
for required in node npm corepack go rsync curl unzip yq swag; do
  command -v "$required" >/dev/null || { echo "Missing build dependency: $required" >&2; exit 1; }
done
[[ "$(node -p 'Number(process.versions.node.split(".")[0])')" -ge 22 ]]
[[ -n "${GEOIP_DB:-}" && -s "$GEOIP_DB" ]] || {
  echo "Set GEOIP_DB to a valid, licensed country.mmdb before building." >&2; exit 1;
}
# No production config, credentials or database is read by this script.
(cd frontend/admin && npm ci && npm run build)
(cd frontend/user && corepack pnpm install --frozen-lockfile && corepack pnpm run build)
# Preserve all bundled community themes, then overlay this fork's frontends.
bash script/fetch-frontends.sh
[[ -f frontend/admin/dist/index.html && -f frontend/user/dist/index.html ]]
rsync -a --delete frontend/admin/dist/ cmd/dashboard/admin-dist/
rsync -a --delete frontend/user/dist/ cmd/dashboard/user-dist/
install -m 0644 "$GEOIP_DB" pkg/geoip/geoip.db
swag init --pd -d cmd/dashboard -g main.go -o cmd/dashboard/docs
mkdir -p dist
version="${VERSION:-dev-$(git rev-parse --short HEAD)}"
CGO_ENABLED=1 go build -tags go_json -trimpath -buildvcs=false \
  -ldflags "-s -w -X github.com/nezhahq/nezha/service/singleton.Version=$version" \
  -o dist/dashboard ./cmd/dashboard
sha256sum dist/dashboard
