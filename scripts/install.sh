#!/bin/sh
# shini74744/agent only. Elevate through sudo when needed; never falls back to upstream.
set -eu
umask 077
if [ "$(id -u)" -ne 0 ]; then
 command -v sudo >/dev/null 2>&1 || { echo "sudo is required. Install sudo or run this script as root." >&2; exit 1; }
 # Pass only Agent settings through sudo; do not preserve the whole caller environment.
 if [ "${NZ_UUID+x}" = x ]; then
  exec sudo env "NZ_SERVER=${NZ_SERVER:-}" "NZ_TLS=${NZ_TLS:-false}" "NZ_CLIENT_SECRET=${NZ_CLIENT_SECRET:-}" "NZ_UUID=$NZ_UUID" sh "$0" "$@"
 else
  exec sudo env "NZ_SERVER=${NZ_SERVER:-}" "NZ_TLS=${NZ_TLS:-false}" "NZ_CLIENT_SECRET=${NZ_CLIENT_SECRET:-}" sh "$0" "$@"
 fi
fi
case "$(uname -s)" in
 Linux) os=linux ;;
 Darwin) os=darwin ;;
 FreeBSD) os=freebsd ;;
 *) echo "Unsupported operating system" >&2; exit 1 ;;
esac
case "$(uname -m)" in
 x86_64|amd64) arch=amd64 ;;
 aarch64|arm64) arch=arm64 ;;
 i386|i686) arch=386 ;;
 armv*|arm) arch=arm ;;
 mips) arch=mips ;;
 mipsel|mipsle) arch=mipsle ;;
 riscv64|s390x|loong64) arch=$(uname -m) ;;
 loongarch64) arch=loong64 ;;
 *) echo "Unsupported CPU architecture" >&2; exit 1 ;;
esac
for tool in curl unzip; do
 command -v "$tool" >/dev/null || { echo "Required dependency missing: $tool" >&2; exit 1; }
done
if command -v sha256sum >/dev/null; then hash_tool=sha256sum
elif command -v shasum >/dev/null; then hash_tool=shasum
elif command -v sha256 >/dev/null; then hash_tool=sha256
else echo "SHA256 utility required" >&2; exit 1; fi
dir=/opt/nezha/agent
binary="$dir/nezha-agent"
config="$dir/config.yml"
[ -n "${NZ_SERVER:-}" ] || [ -f "$config" ] || { echo "NZ_SERVER is required" >&2; exit 1; }
[ -n "${NZ_CLIENT_SECRET:-}" ] || [ -f "$config" ] || { echo "NZ_CLIENT_SECRET is required" >&2; exit 1; }
tmp=$(mktemp -d)
trap 'rm -f "$tmp/agent.zip" "$tmp/checksum" "$tmp/nezha-agent"; rmdir "$tmp" 2>/dev/null || true' EXIT
asset="nezha-agent_${os}_${arch}.zip"
base=https://github.com/shini74744/agent/releases/latest/download
curl --fail --location --retry 3 --connect-timeout 20 --max-time 300 "$base/$asset.sha256" -o "$tmp/checksum"
curl --fail --location --retry 3 --connect-timeout 20 --max-time 600 "$base/$asset" -o "$tmp/agent.zip"
expected=$(tr -d '\r\n' < "$tmp/checksum")
[ "${#expected}" -eq 64 ] || { echo "Invalid checksum" >&2; exit 1; }
case "$expected" in *[!0-9a-fA-F]*) echo "Invalid checksum" >&2; exit 1 ;; esac
case "$hash_tool" in
 sha256sum) actual=$(sha256sum "$tmp/agent.zip" | awk '{print $1}') ;;
 shasum) actual=$(shasum -a 256 "$tmp/agent.zip" | awk '{print $1}') ;;
 sha256) actual=$(sha256 -q "$tmp/agent.zip") ;;
esac
[ "$actual" = "$expected" ] || { echo "SHA256 mismatch; existing agent unchanged" >&2; exit 1; }
unzip -p "$tmp/agent.zip" nezha-agent > "$tmp/nezha-agent"
chmod 755 "$tmp/nezha-agent"
"$tmp/nezha-agent" -v
mkdir -p "$dir"
backup=$(mktemp -d "$dir/backup.XXXXXXXX")
[ ! -f "$binary" ] || cp -p "$binary" "$backup/nezha-agent"
[ ! -f "$config" ] || cp -p "$config" "$backup/config.yml"
rollback() {
 echo "Installation failed. Backup: $backup" >&2
 if [ -f "$backup/nezha-agent" ]; then
  cp -p "$backup/nezha-agent" "$binary"
  [ ! -f "$backup/config.yml" ] || cp -p "$backup/config.yml" "$config"
  "$binary" service install || true
  "$binary" service start || true
 fi
 exit 1
}
if [ -f "$binary" ]; then "$binary" service stop || true; fi
install -m 755 "$tmp/nezha-agent" "$binary" || rollback
# Re-register the same service; do not delete config or change the UUID.
"$binary" service uninstall >/dev/null 2>&1 || true
"$binary" service install || rollback
"$binary" service start || rollback
printf '\033[0;32m%s\033[0m\n' "nezha-agent successfully installed and started（安装成功，服务已启动）"
printf '%s\n' "下载来源：shini74744/agent"
printf '%s\n' "配置及旧程序备份：$backup"
printf '%s\n' "是否已连接面板，请查看面板在线状态；服务启动成功不代表认证或连接成功。"
