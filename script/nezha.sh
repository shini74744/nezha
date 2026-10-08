#!/usr/bin/env bash
# Management entry point for shini74744/nezha. Never fall back to upstream.
set -Eeuo pipefail
umask 077
readonly REPOSITORY="shini74744/nezha"
readonly DOWNLOAD_ROOT="https://github.com/$REPOSITORY/releases"
BASE="${NZ_BASE_PATH:-/opt/nezha}"
UNIT="${NZ_SYSTEMD_UNIT:-nezha-dashboard}"
UNIT_DIR="${NZ_UNIT_DIR:-/etc/systemd/system}"
DASHBOARD="$BASE/dashboard"
workdir=""
cleanup() {
 if [[ -n "$workdir" && "$workdir" == "$BASE"/.download.* ]]; then
  rm -f -- "$workdir/version.txt" "$workdir/SHA256SUMS" "$workdir/package.zip" "$workdir/app" "$workdir/nezha.sh" "$workdir/nezha-dashboard.service"
  rmdir -- "$workdir" 2>/dev/null || true
 fi
}
trap cleanup EXIT
fail() { printf '失败：%s\n' "$*" >&2; return 1; }
step() { printf '%s\n' "$*"; }
root_required() { [[ "$(id -u)" == 0 ]] || { fail "请使用 root 或 sudo 执行"; return 1; }; }
lock_operation() {
 root_required
 [[ "$BASE" = /* && "$BASE" != / && "$BASE" != /opt ]] || { fail "无效安装目录"; return 1; }
 [[ "$UNIT" =~ ^[a-zA-Z0-9_.-]+$ ]] || { fail "无效服务名"; return 1; }
 mkdir -p -- "$BASE"
 exec 9>"$BASE/.manager.lock"
 flock -n 9 || { fail "另一个面板管理操作正在进行"; return 1; }
}
fetch() { curl --fail --show-error --silent --location --proto '=https' --tlsv1.2 --connect-timeout 15 --max-time 180 --retry 2 "$1" -o "$2"; }
stage_release() {
 command -v curl >/dev/null
 command -v sha256sum >/dev/null
 workdir="$(mktemp -d "$BASE/.download.XXXXXXXX")"
 step "[准备] 正在查询 $REPOSITORY 的发布版本"
 fetch "$DOWNLOAD_ROOT/latest/download/version.txt" "$workdir/version.txt"
 version="$(tr -d '\r\n' < "$workdir/version.txt")"
 [[ "$version" =~ ^custom-[0-9A-Za-z._-]+$ ]] || { fail "发布版本无效，保留当前安装"; return 1; }
 release_url="$DOWNLOAD_ROOT/download/$version"
 fetch "$release_url/SHA256SUMS" "$workdir/SHA256SUMS"
}
verify_asset() {
 local asset="$1" file="$2" expected actual
 expected="$(awk -v name="$asset" '$2 == name || $2 == "*" name {print $1}' "$workdir/SHA256SUMS")"
 [[ "$expected" =~ ^[0-9a-fA-F]{64}$ ]] || { fail "$asset 缺少唯一有效校验值"; return 1; }
 actual="$(sha256sum "$file")"; actual="${actual%% *}"
 [[ "${actual,,}" == "${expected,,}" ]] || { fail "$asset 校验失败；不会停止服务或覆盖当前文件"; return 1; }
}
stage_binary() {
 local arch asset
 [[ "$(uname -s)" == Linux ]] || { fail "此管理脚本用于 Linux systemd 部署"; return 1; }
 case "$(uname -m)" in x86_64|amd64) arch=amd64;; aarch64|arm64) arch=arm64;; *) fail "当前架构尚无已验证安装包"; return 1;; esac
 command -v unzip >/dev/null
 stage_release
 asset="dashboard-linux-$arch.zip"
 step "[准备] 下载并校验 $version / $arch（此时不会停止面板）"
 fetch "$release_url/$asset" "$workdir/package.zip"
 verify_asset "$asset" "$workdir/package.zip"
 unzip -p "$workdir/package.zip" "dashboard-linux-$arch" > "$workdir/app"
 [[ -s "$workdir/app" ]] || { fail "安装包没有对应架构的程序"; return 1; }
 chmod 0755 "$workdir/app"
 [[ "$("$workdir/app" -v)" == "$version" ]] || { fail "程序版本与发布信息不一致"; return 1; }
}
phase_logs() {
 if [[ "$invocation" =~ ^[0-9a-f]{32}$ ]]; then
  journalctl "_SYSTEMD_INVOCATION_ID=$invocation" --grep='NEZHA>> Graceful::' -n 30 --no-pager -o cat 2>/dev/null || true
 else
  journalctl -u "$UNIT" --since="@$stop_epoch" --grep='NEZHA>> Graceful::' -n 30 --no-pager -o cat 2>/dev/null || true
 fi
}
stop_panel() {
 local state result status logs previous="" invocation stop_epoch
 state="$(systemctl show "$UNIT" -p ActiveState --value)"
 if [[ "$state" == inactive ]]; then step "[停止] 面板已经停止"; return 0; fi
 invocation="$(systemctl show "$UNIT" -p InvocationID --value)"
 stop_epoch="$(date +%s)"
 step "[停止 1/4] 已发送正常停机请求，等待停止接收新上报"
 systemctl --no-block stop "$UNIT"
 local end=$((SECONDS+120))
 while :; do
  logs="$(phase_logs)"
  if [[ "$logs" == *Graceful::REPORT_ADMISSION_CLOSED* && "$previous" == "" ]]; then
   step "[停止 2/4] 已停止接收新上报，正在处理并写入已接收数据"; previous=draining
  fi
  if [[ "$logs" == *Graceful::FINALIZING_STORAGE* && "$previous" != saving && "$previous" != closed ]]; then
   step "[停止 3/4] 已有上报处理完成，正在保存计数、落盘并关闭数据库"; previous=saving
  fi
  if [[ "$logs" == *Graceful::REPORTS_PERSISTED_STORAGE_CLOSED* && "$previous" != closed ]]; then
   step "[停止 3/4] 数据写入及数据库关闭已完成，正在退出"; previous=closed
  fi
  state="$(systemctl show "$UNIT" -p ActiveState --value)"
  if [[ "$state" == inactive || "$state" == failed ]]; then
   # The process may finish between the journal read and the state query.
   # Read one final time before deciding whether persistence completed.
   logs="$(phase_logs)"
   if [[ "$logs" == *Graceful::REPORT_ADMISSION_CLOSED* && "$previous" == "" ]]; then
    step "[停止 2/4] 已停止接收新上报"; previous=draining
   fi
   if [[ "$logs" == *Graceful::REPORTS_PERSISTED_STORAGE_CLOSED* && "$previous" != closed ]]; then
    step "[停止 3/4] 已接收数据写入及数据库关闭已完成"; previous=closed
   fi
   break
  fi
  if ((SECONDS>=end)); then fail "停止等待超时；未确认完成，不会强制杀进程或继续重启"; return 1; fi
  sleep 1
 done
 result="$(systemctl show "$UNIT" -p Result --value)"
 status="$(systemctl show "$UNIT" -p ExecMainStatus --value)"
 if [[ "$result" != success || "$status" != 0 || "$logs" == *Graceful::INCOMPLETE* ]]; then
  fail "面板没有正常完成停机（result=$result, status=$status）；请查看日志。不会继续重启或更新"
  return 1
 fi
 if [[ "$logs" != *Graceful::REPORTS_PERSISTED_STORAGE_CLOSED* ]]; then
  step "[提示] 该进程未提供新版落盘确认标记，仅确认服务已退出"
 fi
 step "[停止 4/4] 面板已停止"
}
listen_port() {
 local port
 port="$(sed -nE 's/^listen_port:[[:space:]]*([0-9]+).*$/\1/p' "$DASHBOARD/data/config.yaml" | head -n 1)"
 [[ "$port" =~ ^[0-9]+$ ]] || { fail "无法确定 HTTP 端口，请检查 config.yaml"; return 1; }
 ((port>0 && port<65536)) || return 1
 printf '%s' "$port"
}
wait_ready() {
 local port end state
 port="$(listen_port)" || return 1
 end=$((SECONDS+240))
 while ((SECONDS<end)); do
  state="$(systemctl show "$UNIT" -p ActiveState --value)"
  [[ "$state" != failed && "$state" != inactive ]] || return 1
  if curl --fail --silent --max-time 2 "http://127.0.0.1:$port/" -o /dev/null; then
   step "[启动 2/2] 面板已就绪，页面访问正常"; return 0
  fi
  sleep 2
 done
 fail "等待页面就绪超时，请查看服务日志"
}
start_panel() {
 step "[启动 1/2] 正在启动面板并恢复数据库，请稍候"
 systemctl start "$UNIT"
 wait_ready
}
restart_panel() {
 stop_panel || return 1
 start_panel || return 1
 step "重启完成"
}
backup_before_update() {
 backup_dir="$BASE/backups/update-$(date -u +%Y%m%dT%H%M%SZ)-$$"
 install -d -m 0700 "$backup_dir"
 [[ ! -f "$DASHBOARD/app" ]] || cp -p "$DASHBOARD/app" "$backup_dir/app.previous"
 # The service has stopped. Preserve credentials and a consistent SQLite copy;
 # no database is replaced on a binary rollback.
 for name in config.yaml sqlite.db sqlite.db-wal sqlite.db-shm terminal-commands.key; do
  [[ ! -f "$DASHBOARD/data/$name" ]] || cp -p "$DASHBOARD/data/$name" "$backup_dir/$name"
 done
 step "[备份] 旧程序及配置/数据库保留在 $backup_dir"
}
update_panel() {
 lock_operation
 [[ -x "$DASHBOARD/app" ]] || { fail "未找到现有面板，请使用 install"; return 1; }
 stage_binary
 step "[更新] 下载及校验完成，即将按安全停机流程更新"
 stop_panel || return 1
 backup_before_update
 mv -f -- "$workdir/app" "$DASHBOARD/app"
 if start_panel; then
  step "更新完成：$version"
 else
  step "[恢复] 新版本未就绪，正在停止新进程并恢复旧程序"
  systemctl stop "$UNIT" || true
  [[ "$(systemctl show "$UNIT" -p MainPID --value)" == 0 ]] || { fail "新进程未退出，拒绝替换运行文件"; return 1; }
  install -m 0755 "$backup_dir/app.previous" "$DASHBOARD/app.rollback"
  mv -f "$DASHBOARD/app.rollback" "$DASHBOARD/app"
  start_panel || { fail "旧版本恢复启动也失败，备份保留，请检查日志"; return 1; }
  fail "新版本启动失败，已恢复旧程序；业务数据库未被覆盖"
  return 1
 fi
}
update_script() {
 lock_operation
 stage_release
 fetch "$release_url/nezha.sh" "$workdir/nezha.sh"
 verify_asset nezha.sh "$workdir/nezha.sh"
 bash -n "$workdir/nezha.sh"
 backup_dir="$BASE/backups/script-$(date -u +%Y%m%dT%H%M%SZ)-$$"
 install -d -m 0700 "$backup_dir"
 [[ ! -f "$BASE/nezha.sh" ]] || cp -p "$BASE/nezha.sh" "$backup_dir/nezha.sh.previous"
 chmod 0755 "$workdir/nezha.sh"
 mv -f "$workdir/nezha.sh" "$BASE/nezha.sh"
 step "管理脚本已更新，来源：$REPOSITORY；未重启面板"
}
install_panel() {
 lock_operation
 [[ ! -e "$DASHBOARD/app" && ! -e "$DASHBOARD/data/sqlite.db" && ! -e "$DASHBOARD/data/config.yaml" ]] || { fail "发现已有安装或数据；请使用更新，安装操作不会覆盖"; return 1; }
 stage_binary
 fetch "$release_url/nezha-dashboard.service" "$workdir/nezha-dashboard.service"
 verify_asset nezha-dashboard.service "$workdir/nezha-dashboard.service"
 [[ "$BASE" == /opt/nezha && "$UNIT" == nezha-dashboard ]] || { fail "新安装仅支持标准路径和服务名"; return 1; }
 install -d -m 0700 "$DASHBOARD/data"
 # Current v1 config; secrets are generated by the application, not hard-coded.
 printf 'language: zh-CN\nlisten_host: 0.0.0.0\nlisten_port: 8008\ntsdb:\n  data_path: data/tsdb\n' > "$DASHBOARD/data/config.yaml"
 mv "$workdir/app" "$DASHBOARD/app"
 install -m 0644 "$workdir/nezha-dashboard.service" "$UNIT_DIR/$UNIT.service"
 systemctl daemon-reload
 systemctl enable "$UNIT"
 start_panel
 step "安装完成。首次登录后立即修改初始管理员密码，并限制管理入口访问。"
}
show_usage() {
 printf '%s\n' "哪吒面板管理（$REPOSITORY）" \
 "用法：bash /opt/nezha/nezha.sh [命令]" \
 "start                启动并等待就绪" \
 "stop                 停止上报、写入已有数据、关闭并显示进度" \
 "restart              完整停止后启动（不下载更新）" \
 "status               查看运行状态" \
 "show_log             实时查看日志" \
 "version              查看当前版本" \
 "install              安装自己的发布版本（不会覆盖已有数据）" \
 "update               校验、自有版本更新；失败恢复旧程序" \
 "restart_and_update   update 的兼容别名" \
 "update_script        更新为自己的管理脚本" \
 "不会下载官方面板、官方脚本或自动切换官方镜像。"
}
if (($#==0)); then
 printf '%s\n' "哪吒面板管理（$REPOSITORY）" "1. 启动面板" "2. 停止面板" "3. 重启面板" "4. 查看状态" "5. 查看日志" "6. 更新我的面板" "7. 更新我的管理脚本" "8. 安装我的面板" "0. 退出"
 read -r -p '请选择：' choice
 case "$choice" in 1)set -- start;;2)set -- stop;;3)set -- restart;;4)set -- status;;5)set -- show_log;;6)set -- update;;7)set -- update_script;;8)set -- install;;0)exit 0;;*)show_usage;exit 1;;esac
fi
case "$1" in
 start)lock_operation;start_panel;;
 stop)lock_operation;stop_panel;;
 restart)lock_operation;restart_panel;;
 status)systemctl status "$UNIT" --no-pager;;
 show_log)journalctl -u "$UNIT" -f;;
 version)"$DASHBOARD/app" -v;;
 install)install_panel;;
 update|restart_and_update)update_panel;;
 update_script)update_script;;
 help|-h|--help)show_usage;;
 *)show_usage;exit 1;;
esac
