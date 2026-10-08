#!/usr/bin/env bash
# Bootstrap only this fork's published, checksummed management script.
set -Eeuo pipefail
umask 077
readonly releases="https://github.com/shini74744/nezha/releases"
stage="$(mktemp -d)"
trap 'rm -f -- "$stage/version.txt" "$stage/SHA256SUMS" "$stage/nezha.sh"; rmdir -- "$stage"' EXIT
fetch() { curl --fail --show-error --silent --location --proto '=https' --tlsv1.2 --connect-timeout 15 --max-time 180 "$1" -o "$2"; }
fetch "$releases/latest/download/version.txt" "$stage/version.txt"
version="$(tr -d '\r\n' < "$stage/version.txt")"
[[ "$version" =~ ^custom-[0-9A-Za-z._-]+$ ]] || { echo "没有有效的自有发布版本" >&2; exit 1; }
fetch "$releases/download/$version/SHA256SUMS" "$stage/SHA256SUMS"
fetch "$releases/download/$version/nezha.sh" "$stage/nezha.sh"
expected="$(awk '$2=="nezha.sh" || $2=="*nezha.sh" {print $1}' "$stage/SHA256SUMS")"
[[ "$expected" =~ ^[0-9a-fA-F]{64}$ ]] || exit 1
actual="$(sha256sum "$stage/nezha.sh")"; actual="${actual%% *}"
[[ "${actual,,}" == "${expected,,}" ]] || { echo "脚本校验失败，未安装" >&2; exit 1; }
bash -n "$stage/nezha.sh"
[[ "$(id -u)" == 0 ]] || { echo "请使用 root 或 sudo 执行" >&2; exit 1; }
mkdir -p /opt/nezha
if [[ -f /opt/nezha/nezha.sh ]]; then
 backup="/opt/nezha/backups/bootstrap-$(date -u +%Y%m%dT%H%M%SZ)-$$"
 install -d -m 0700 "$backup"
 cp -p /opt/nezha/nezha.sh "$backup/nezha.sh.previous"
fi
install -m 0755 "$stage/nezha.sh" /opt/nezha/nezha.sh.new
mv -f /opt/nezha/nezha.sh.new /opt/nezha/nezha.sh
if (($#==0)); then set -- install; fi
bash /opt/nezha/nezha.sh "$@"
