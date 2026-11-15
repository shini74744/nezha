#!/bin/sh
# DDnezha backup receiver installer. This installer never changes SSH or firewall rules.
set -eu
umask 077
fail() { printf 'DDNEZHA_BACKUP_ERROR: %s\n' "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || fail '需要 root 权限安装备份接收端'
[ "$(uname -s)" = Linux ] || fail '自动安装暂支持 Linux；其他系统可使用已有 SFTP 连接'
: "${DDNZ_BACKUP_USER:?缺少备份账号}"
: "${DDNZ_BACKUP_PUBLIC_KEY:?缺少面板公钥}"
: "${DDNZ_BACKUP_DIRECTORY:=/var/lib/ddnezha-backup/backups}"
: "${DDNZ_BACKUP_PORT:=2022}"
version=v0.1.0
case "$(uname -m)" in
 x86_64|amd64) arch=amd64 ;;
 aarch64|arm64) arch=arm64 ;;
 armv7l|armv6l) arch=armv7 ;;
 *) fail '此架构尚无备份接收端安装包' ;;
esac
case "$DDNZ_BACKUP_PORT" in ''|*[!0-9]*) fail '备份端口无效';; esac
[ "$DDNZ_BACKUP_PORT" -ge 1024 ] && [ "$DDNZ_BACKUP_PORT" -le 65535 ] || fail '备份端口须为 1024 至 65535'
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then manager=systemd
elif command -v rc-service >/dev/null 2>&1 && command -v rc-update >/dev/null 2>&1; then manager=openrc
else fail '未检测到 systemd 或 OpenRC，请按文档手动运行接收端'; fi
command -v sha256sum >/dev/null 2>&1 || fail '缺少 sha256sum，无法校验安装包'
download() {
 if command -v curl >/dev/null 2>&1; then curl -fL --proto '=https' --tlsv1.2 --connect-timeout 15 --max-time 60 --retry 1 "$1" -o "$2"
 elif command -v wget >/dev/null 2>&1; then wget -T 60 -O "$2" "$1"
 else fail '缺少 curl 或 wget'; fi
}
state=/etc/ddnezha-backup
binary=/opt/ddnezha-backup/receiver
service=ddnezha-backup
# Only our own install location and service may be replaced.
for entry in /etc/ddnezha-backup /opt/ddnezha-backup /opt/ddnezha-backup/receiver; do
 [ ! -L "$entry" ] || fail "安装路径是符号链接: $entry"
done
[ ! -e "$binary" ] || [ -f "$state/.ddnezha-receiver" ] || fail '安装位置已有未知程序，已停止'
running=no
if [ "$manager" = systemd ]; then
 systemctl is-active --quiet "$service" && running=yes || true
 unit=/etc/systemd/system/ddnezha-backup.service
else
 rc-service "$service" status >/dev/null 2>&1 && running=yes || true
 unit=/etc/init.d/ddnezha-backup
fi
[ ! -e "$unit" ] || grep -q 'DDnezha backup receiver' "$unit" || fail '同名服务不是本程序创建的'
if [ "$running" = no ] && command -v ss >/dev/null 2>&1; then
 [ -z "$(ss -H -ltn "sport = :$DDNZ_BACKUP_PORT")" ] || fail '备份端口已被占用，请选择其他端口'
fi
tmp=$(mktemp -d /tmp/ddnezha-backup-install.XXXXXX)
changed=no
success=no
install_lock=/run/ddnezha-backup-install.lock
lock_owned=no
cleanup() {
 status=$?
 if [ "$changed" = yes ] && [ "$success" != yes ]; then
  if [ -f "$tmp/old-binary" ]; then cp "$tmp/old-binary" /opt/ddnezha-backup/receiver.rollback; chmod 755 /opt/ddnezha-backup/receiver.rollback; mv /opt/ddnezha-backup/receiver.rollback "$binary"; fi
  if [ -f "$tmp/old-config" ]; then cp "$tmp/old-config" "$state/receiver.json"; chmod 600 "$state/receiver.json"; fi
  if [ -f "$tmp/old-unit" ]; then cp "$tmp/old-unit" "$unit"; fi
  if [ "$running" = yes ]; then
   if [ "$manager" = systemd ]; then systemctl daemon-reload; systemctl restart "$service" || true
   else rc-service "$service" restart || true; fi
  else
   if [ "$manager" = systemd ]; then systemctl stop "$service" >/dev/null 2>&1 || true
   else rc-service "$service" stop >/dev/null 2>&1 || true; fi
  fi
 fi
 if [ "$lock_owned" = yes ]; then rmdir "$install_lock"; fi
 case "$tmp" in /tmp/ddnezha-backup-install.*) rm -rf -- "$tmp";; esac
 exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP
mkdir "$install_lock" 2>/dev/null || fail '已有接收端安装任务正在执行，请稍后重试'
lock_owned=yes
asset="ddnezha-backup-linux-$arch"
base="https://github.com/shini74744/nezha/releases/download/backup-$version"
download "$base/$asset" "$tmp/receiver"
download "$base/SHA256SUMS" "$tmp/SHA256SUMS"
checksum=$(awk -v name="$asset" '{gsub(/\r$/, ""); if ($2==name || $2=="*" name) print $1}' "$tmp/SHA256SUMS")
[ "${#checksum}" = 64 ] || fail '安装包校验文件格式错误'
case "$checksum" in *[!a-fA-F0-9]*) fail '安装包校验值无效';; esac
printf '%s  %s\n' "$checksum" "$tmp/receiver" | sha256sum -c - || fail '安装包校验失败，未安装'
chmod 700 "$tmp/receiver"
[ "$("$tmp/receiver" --version)" = "$version" ] || fail '安装包版本不匹配'
mkdir -p "$state" /opt/ddnezha-backup
chmod 700 "$state"
[ ! -f "$binary" ] || cp "$binary" "$tmp/old-binary"
[ ! -f "$state/receiver.json" ] || cp "$state/receiver.json" "$tmp/old-config"
[ ! -f "$unit" ] || cp "$unit" "$tmp/old-unit"
changed=yes
"$tmp/receiver" --configure --user "$DDNZ_BACKUP_USER" --directory "$DDNZ_BACKUP_DIRECTORY" --public-key "$DDNZ_BACKUP_PUBLIC_KEY" --port "$DDNZ_BACKUP_PORT" > "$tmp/receipt"
cp "$tmp/receiver" /opt/ddnezha-backup/receiver.new
chmod 755 /opt/ddnezha-backup/receiver.new
mv /opt/ddnezha-backup/receiver.new "$binary"
printf '%s\n' 'DDnezha backup receiver' > "$state/.ddnezha-receiver"
if [ "$manager" = systemd ]; then
 cat > "$unit" <<'UNIT'
# DDnezha backup receiver
[Unit]
Description=DDnezha backup receiver
After=network.target
[Service]
ExecStart=/opt/ddnezha-backup/receiver
Restart=on-failure
RestartSec=3
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LimitNOFILE=1024
[Install]
WantedBy=multi-user.target
UNIT
 systemctl daemon-reload
 systemctl enable "$service" >/dev/null
 if [ "$running" = yes ] && cmp -s "$tmp/old-binary" "$binary"; then :
 else systemctl restart "$service"; fi
 sleep 1
 systemctl is-active --quiet "$service" || fail '接收端未能启动，请检查端口和服务日志'
else
 cat > "$unit" <<'RC'
#!/sbin/openrc-run
# DDnezha backup receiver
name="DDnezha backup receiver"
command="/opt/ddnezha-backup/receiver"
command_background="yes"
pidfile="/run/ddnezha-backup.pid"
output_log="/var/log/ddnezha-backup.log"
error_log="/var/log/ddnezha-backup.log"
depend() { need net; }
RC
 chmod 755 "$unit"
 rc-update add "$service" default >/dev/null
 if [ "$running" = yes ] && cmp -s "$tmp/old-binary" "$binary"; then :
 else rc-service "$service" restart; fi
 rc-service "$service" status >/dev/null || fail '接收端未能启动，请检查端口和服务日志'
fi
success=yes
cat "$tmp/receipt"
printf 'DDNEZHA_BACKUP_PORT=%s\n' "$DDNZ_BACKUP_PORT"
