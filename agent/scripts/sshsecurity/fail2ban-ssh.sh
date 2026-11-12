#!/bin/sh
# DDnezha SSH-only adapter, derived from shini74744/jj fb5.sh.
# Upstream SHA256: 6dbac7e761b77bbd9f7fd914eb71dff8d6e986c3d46d4ba34ea3b7e005995a19
# No XUI, global firewall flush, package repair or remote self-update.
set -eu
export LC_ALL=C
fail() { printf '%s\n' "$*" >&2; exit 1; }
detect_os() { awk -F= '/^(ID|ID_LIKE)=/ {gsub(/["\047]/,"",$2);printf " %s ",$2}' "$1"; }
install_plan() {
 family=$(detect_os "$1")
 extra=''
 if ! command -v nft >/dev/null 2>&1; then
  if ! command -v iptables >/dev/null 2>&1 || ! command -v ip6tables >/dev/null 2>&1; then extra=' iptables'; fi
 fi
 case "$family" in
 *" debian "*|*" ubuntu "*)
 printf '%s\n' 'apt-get -o DPkg::Lock::Timeout=120 update' "apt-get -o DPkg::Lock::Timeout=120 -y --no-upgrade --no-install-recommends install fail2ban$extra";;
 *" alpine "*) printf '%s\n' "apk add fail2ban fail2ban-openrc$extra${extra:+ ip6tables}";;
 *" rhel "*|*" centos "*|*" rocky "*|*" almalinux "*)
 pm=dnf; command -v dnf >/dev/null 2>&1 || pm=yum
 printf '%s\n' "$pm -y install epel-release" "$pm -y install fail2ban$extra";;
 *" fedora "*) printf '%s\n' "dnf -y install fail2ban$extra";;
 *" suse "*|*" opensuse "*|*" opensuse-leap "*|*" opensuse-tumbleweed "*|*" sles "*)
 printf '%s\n' "zypper --non-interactive install --no-recommends fail2ban$extra";;
 *) fail '当前系统暂不支持自动安装 Fail2ban';;
 esac
}
install_components() {
 [ "$(id -u)" = 0 ] || fail '安装 Fail2ban 需要管理员权限'
 command -v fail2ban-client >/dev/null 2>&1 && return
 # A package may auto-start the daemon. Refuse unknown leftovers and prevent
 # the distribution default SSH jail from silently changing unrelated rules.
 for d in /etc/fail2ban /etc/fail2ban/jail.d; do
  [ ! -L "$d" ] || fail 'Fail2ban 配置目录不能是符号链接'
 done
 if [ -d /etc/fail2ban ]; then
  find /etc/fail2ban -type f \( -name '*.local' -o -name '*.conf' \) -exec sh -c '
   for f do
    IFS= read -r first < "$f" || true
    [ "$first" = "# Managed by DDnezha SSH protection." ] || exit 1
   done' sh {} + || fail '发现原有 Fail2ban 配置，请先恢复原有安装'
 fi
 umask 077
 mkdir -p /etc/fail2ban/jail.d
 safe=/etc/fail2ban/jail.d/zzzzzz-ddnezha-install.local
 [ ! -L "$safe" ] || fail '安装配置文件无效'
 printf '%s\n' '# Managed by DDnezha SSH protection.' '[sshd]' 'enabled = false' > "$safe"
 export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l
 plan=$(install_plan /etc/os-release) || exit 1
 printf '%s\n' "$plan" | while IFS= read -r step; do
  set -f
  # Only literal commands from install_plan; never eval remote or user text.
  set -- $step
  (umask 022; "$@") || fail 'Fail2ban 安装失败，请检查软件源后重试'
 done
 command -v fail2ban-client >/dev/null 2>&1 || fail '未找到 Fail2ban 程序'
}
firewall() {
 if command -v nft >/dev/null 2>&1; then printf 'nftables\n'
 elif command -v iptables >/dev/null 2>&1 && command -v ip6tables >/dev/null 2>&1; then printf 'iptables\n'
 else fail '未找到受支持的 SSH 防火墙组件'; fi
}
owned_jail() {
 case "$1" in ddnezha-ssh-*) ;; *) fail '不是 DDnezha SSH 防护配置';; esac
 case "$1" in *[!a-zA-Z0-9-]*|'') fail '防护名称无效';; esac
 [ "${#1}" -le 64 ] || fail '防护名称无效'
}
case "${1:---help}" in
 --plan) [ "$#" = 2 ] || fail '需要 os-release 路径'; install_plan "$2";;
 install) [ "$#" = 1 ] || fail '参数无效'; install_components;;
 firewall) firewall;;
 apply)
 [ "$#" = 2 ] || fail '参数无效'; owned_jail "$2"
 fail2ban-client -t
 fail2ban-client reload --if-exists "$2"
 fail2ban-client status "$2";;
 status|bans|unban)
 operation=$1; [ "$#" -ge 2 ] || fail '参数无效'; owned_jail "$2"; jail=$2
 case "$operation" in
 status) [ "$#" = 2 ] || fail '参数无效'; fail2ban-client status "$jail";;
 bans) [ "$#" = 2 ] || fail '参数无效'; fail2ban-client get "$jail" banip --with-time;;
 unban)
 [ "$#" = 3 ] || fail '参数无效'
 case "$3" in ''|*[!0-9a-fA-F.:]*) fail 'IP 地址无效';; esac
 fail2ban-client set "$jail" unbanip "$3";;
 esac;;
 --help) printf '%s\n' 'DDnezha SSH Fail2ban' 'install | firewall | apply JAIL | status JAIL | bans JAIL | unban JAIL IP';;
 *) fail '未知操作';;
esac
