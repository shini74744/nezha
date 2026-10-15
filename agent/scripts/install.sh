#!/bin/sh
# DDnezha-owned-agent-installer-v1
# shini74744/nezha Agent channel only. Elevate through sudo when needed; never falls back to upstream.
set -eu
umask 077
usage() {
 printf '%s\n' "Usage: $0 [install|uninstall]" \
  "  install    Install/update Agent (default)." \
  "  uninstall  Stop/remove Agent services and their top-level *config*.yml files; keep binary/backups."
}
[ "$#" -le 1 ] || { usage >&2; exit 2; }
case "${1:-install}" in
 install|uninstall) action=${1:-install} ;;
 -h|--help) usage; exit 0 ;;
 *) usage >&2; exit 2 ;;
esac
if [ "$(id -u)" -ne 0 ]; then
 command -v sudo >/dev/null 2>&1 || { echo "sudo is required. Install sudo or run this script as root." >&2; exit 1; }
 # Pass only Agent settings through sudo; do not preserve the whole caller environment.
 if [ "${DDNZ_UUID+x}" = x ]; then
  exec sudo env "DDNZ_SERVER=${DDNZ_SERVER:-}" "DDNZ_TLS=${DDNZ_TLS:-false}" "DDNZ_CLIENT_SECRET=${DDNZ_CLIENT_SECRET:-}" "DDNZ_UUID=$DDNZ_UUID" sh "$0" "$@"
 else
  exec sudo env "DDNZ_SERVER=${DDNZ_SERVER:-}" "DDNZ_TLS=${DDNZ_TLS:-false}" "DDNZ_CLIENT_SECRET=${DDNZ_CLIENT_SECRET:-}" sh "$0" "$@"
 fi
fi
dir=/opt/DDnezha
binary="$dir/DDnezha"
config="$dir/config.yml"
marker="$dir/.DDnezha-owned"
installer="$dir/agent.sh"
installer_marker="# DDnezha-owned-agent-installer-v1"
owned_installation() {
 [ -f "$marker" ] && [ ! -L "$marker" ] || return 1
 IFS= read -r owner < "$marker" || return 1
 [ "$owner" = DDnezha ]
}
# Never follow links into the official installation or adopt unknown contents.
[ ! -L "$dir" ] && [ ! -L "$binary" ] && [ ! -L "$config" ] && [ ! -L "$marker" ] || {
 echo "DDnezha refuses symlinked installation paths." >&2; exit 1;
}
if [ -e "$dir" ] && [ ! -d "$dir" ]; then
 echo "DDnezha installation path is not a directory." >&2; exit 1
fi
for existing in "$binary" "$marker" "$dir"/*config*.yml; do
 if [ -e "$existing" ] && ! owned_installation; then
  echo "DDnezha ownership cannot be verified; no existing service or file was changed. Migrate explicitly." >&2
  exit 1
 fi
done

uninstall() {
 # Do not recurse: backup.*/config.yml belongs to a rollback, not a live service.
 [ ! -L "$dir" ] || { echo "Refusing to uninstall through a symlinked Agent directory." >&2; return 1; }
 found=0
 failed=0
 for config_file in "$dir"/*config*.yml; do
  if [ -L "$config_file" ]; then
   printf '%s\n' "Refusing symlinked configuration: $config_file" >&2
   failed=1
   continue
  fi
  [ -f "$config_file" ] || continue
  found=1
  if [ ! -x "$binary" ] || [ -L "$binary" ]; then
   echo "Agent binary missing, not executable or symlinked; configurations retained." >&2
   return 1
  fi
  # An already stopped service can reject stop; uninstall must still succeed
  # before we remove its configuration. Never suppress uninstall failures.
  "$binary" service -c "$config_file" stop || true
  if "$binary" service -c "$config_file" uninstall; then
   if rm -f -- "$config_file"; then
    printf '%s\n' "已卸载 Agent 服务并移除配置：$config_file"
   else
    printf '%s\n' "服务已卸载，但配置删除失败：$config_file" >&2
    failed=1
   fi
  else
   printf '%s\n' "Agent 服务卸载失败，已保留配置：$config_file" >&2
   failed=1
  fi
 done
 [ "$failed" -eq 0 ] || return 1
 if [ "$found" -eq 0 ]; then
  printf '%s\n' "未找到 Agent 配置，无需卸载；未改动任何服务。"
 else
  printf '\033[0;32m%s\033[0m\n' "Uninstallation completed.（卸载完成，程序和历史备份已保留）"
 fi
}
if [ "$action" = uninstall ]; then
 uninstall
 exit 0
fi

printf '\033[0;32m%s\033[0m\n' "安装脚本 agent.sh 已就绪"
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
[ -n "${DDNZ_SERVER:-}" ] || [ -f "$config" ] || { echo "DDNZ_SERVER is required" >&2; exit 1; }
[ -n "${DDNZ_CLIENT_SECRET:-}" ] || [ -f "$config" ] || { echo "DDNZ_CLIENT_SECRET is required" >&2; exit 1; }
if [ -L "$installer" ] || { [ -e "$installer" ] && { [ ! -f "$installer" ] || ! grep -qxF "$installer_marker" "$installer"; }; }; then
 echo "Refusing to replace an unknown or symlinked agent.sh; existing files and services unchanged." >&2; exit 1
fi
tmp=$(mktemp -d)
trap 'rm -f "$tmp/agent.zip" "$tmp/checksum" "$tmp/version" "$tmp/DDnezha" "$tmp/agent.sh"; rmdir "$tmp" 2>/dev/null || true' EXIT
asset="DDnezha_${os}_${arch}.zip"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 --retry 3 --connect-timeout 20 --max-time 60 https://raw.githubusercontent.com/shini74744/nezha/main/release/agent-version.txt -o "$tmp/version"
version=$(tr -d '\r\n' < "$tmp/version")
printf '%s\n' "$version" | LC_ALL=C grep -Eq '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' || { echo "Invalid Agent channel version" >&2; exit 1; }
base="https://github.com/shini74744/nezha/releases/download/agent-$version"
curl --fail --location --proto '=https' --tlsv1.2 --retry 3 --connect-timeout 20 --max-time 300 "$base/$asset.sha256" -o "$tmp/checksum"
printf '\033[0;32m%s\033[0m\n' "校验文件下载成功"
curl --fail --location --proto '=https' --tlsv1.2 --retry 3 --connect-timeout 20 --max-time 600 "$base/$asset" -o "$tmp/agent.zip"
printf '\033[0;32m%s\033[0m\n' "Agent 程序下载成功"
expected=$(tr -d '\r\n' < "$tmp/checksum")
[ "${#expected}" -eq 64 ] || { echo "Invalid checksum" >&2; exit 1; }
case "$expected" in *[!0-9a-fA-F]*) echo "Invalid checksum" >&2; exit 1 ;; esac
case "$hash_tool" in
 sha256sum) actual=$(sha256sum "$tmp/agent.zip" | awk '{print $1}') ;;
 shasum) actual=$(shasum -a 256 "$tmp/agent.zip" | awk '{print $1}') ;;
 sha256) actual=$(sha256 -q "$tmp/agent.zip") ;;
esac
[ "$actual" = "$expected" ] || { echo "SHA256 mismatch; existing agent unchanged" >&2; exit 1; }
printf '\033[0;32m%s\033[0m\n' "Agent 文件 SHA-256 校验成功"
unzip -p "$tmp/agent.zip" DDnezha > "$tmp/DDnezha"
chmod 755 "$tmp/DDnezha"
actual_version=$("$tmp/DDnezha" -v)
[ "$actual_version" = "DDnezha version ${version#v}" ] || { echo "Agent version mismatch; existing agent unchanged" >&2; exit 1; }
# Save the exact installer that was executed, never a second unverified download.
[ -f "$0" ] && [ ! -L "$0" ] && grep -qxF "$installer_marker" "$0" || {
 echo "Run this installer from a regular file, not a pipe or symlink." >&2; exit 1;
}
cp "$0" "$tmp/agent.sh"
chmod 755 "$tmp/agent.sh"
mkdir -p "$dir"
chmod 700 "$dir"
printf '%s\n' DDnezha > "$marker"
chmod 600 "$marker"
backup=$(mktemp -d "$dir/backup.XXXXXXXX")
[ ! -f "$binary" ] || cp -p "$binary" "$backup/DDnezha"
[ ! -f "$config" ] || cp -p "$config" "$backup/config.yml"
[ ! -f "$installer" ] || cp -p "$installer" "$backup/agent.sh"
# Stage on the destination filesystem for an atomic replacement after service setup.
cp "$tmp/agent.sh" "$backup/agent.sh.new"
chmod 755 "$backup/agent.sh.new"
rollback() {
 echo "Installation failed. Backup: $backup" >&2
 if [ -f "$backup/DDnezha" ]; then
  cp -p "$backup/DDnezha" "$binary"
  [ ! -f "$backup/config.yml" ] || cp -p "$backup/config.yml" "$config"
  "$binary" service install || true
  "$binary" service start || true
 fi
 exit 1
}
if [ -f "$binary" ]; then "$binary" service stop || true; fi
install -m 755 "$tmp/DDnezha" "$binary" || rollback
# Re-register the same service; do not delete config or change the UUID.
"$binary" service uninstall >/dev/null 2>&1 || true
# service install also starts the service; loading it twice fails on launchd.
"$binary" service install || rollback
mv -f "$backup/agent.sh.new" "$installer" || rollback
printf '%s\n' "管理脚本：$installer；卸载：cd $dir && ./agent.sh uninstall"
printf '\033[0;32m%s\033[0m\n' "DDnezha successfully installed and started（安装成功，服务已启动）"
if [ -f "$backup/DDnezha" ] || [ -f "$backup/config.yml" ]; then
 printf '%s\n' "已有配置或旧程序备份：$backup"
fi
printf '%s\n' "是否已连接面板，请查看面板在线状态；服务启动成功不代表认证或连接成功。"
