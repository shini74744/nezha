#!/usr/bin/env bash
# Build the dashboard with already prepared frontend assets and a reviewed GeoIP DB.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$root"
: "${GEOIP_DB:?Set GEOIP_DB to the reviewed country.mmdb file}"
: "${VERSION:?Set VERSION to the dashboard release version}"
output="${OUTPUT:-dist/dashboard}"
[[ -s "$GEOIP_DB" ]] || { echo "GeoIP database is missing" >&2; exit 1; }
# Restore the source placeholder after building; never publish licensed data in Git.
original="$(mktemp)"
cp -p pkg/geoip/geoip.db "$original"
trap 'cp -p "$original" pkg/geoip/geoip.db; rm -f "$original"' EXIT
install -m 0644 "$GEOIP_DB" pkg/geoip/geoip.db
go test -mod=readonly -tags go_json,releaseassets -count=1 ./pkg/geoip
mkdir -p "$(dirname "$output")"
CGO_ENABLED=1 go build -p "${BUILD_JOBS:-2}" -mod=readonly -tags go_json -trimpath -buildvcs=false \
 -ldflags "-s -w -X github.com/nezhahq/nezha/service/singleton.Version=$VERSION" \
 -o "$output" ./cmd/dashboard
"$output" -check-geoip
sha256sum "$output"
