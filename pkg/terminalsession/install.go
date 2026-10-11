package terminalsession

// InstallTmuxCommand installs only tmux and package dependencies. It never upgrades
// the system or exposes package-manager output (which may contain repository credentials).
const InstallTmuxCommand = `umask 077
export LC_ALL=C
if command -v tmux >/dev/null 2>&1; then printf 'NZX_INSTALLED\n'; exit 0; fi
if [ "$(id -u)" != 0 ]; then printf 'NZX_PERMISSION\n'; exit 0; fi
if ! command -v timeout >/dev/null 2>&1; then printf 'NZX_TIMEOUT_TOOL\n'; exit 0; fi
log=$(mktemp /tmp/nezha-tmux-install.XXXXXX) || { printf 'NZX_DISK\n'; exit 0; }
trap 'rm -f -- "$log"' EXIT
if command -v apt-get >/dev/null 2>&1; then
 job='export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l; apt-get -o Acquire::Retries=1 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 -o DPkg::Lock::Timeout=15 update && apt-get -o Acquire::Retries=1 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 -o DPkg::Lock::Timeout=15 install -y --no-install-recommends tmux'
elif command -v apk >/dev/null 2>&1; then
 job='apk add --no-cache tmux'
elif command -v dnf >/dev/null 2>&1; then
 job='dnf --setopt=timeout=30 --setopt=retries=1 install -y tmux'
elif command -v yum >/dev/null 2>&1; then
 job='yum --setopt=timeout=30 --setopt=retries=1 install -y tmux'
elif command -v zypper >/dev/null 2>&1; then
 job='zypper --non-interactive install --no-recommends tmux'
elif command -v pacman >/dev/null 2>&1; then
 job='pacman -S --noconfirm --needed tmux'
else
 printf 'NZX_UNSUPPORTED\n'; exit 0
fi
timeout -s TERM 300 sh -c "$job" >"$log" 2>&1
code=$?
if command -v tmux >/dev/null 2>&1 && tmux -V >/dev/null 2>&1; then printf 'NZX_INSTALLED\n'
elif [ "$code" = 124 ] || [ "$code" = 137 ]; then printf 'NZX_TIMEOUT\n'
elif grep -Eqi 'No space left|not enough free space' "$log"; then printf 'NZX_DISK\n'
elif grep -Eqi 'Could not get lock|Unable to acquire|locked by|another process|database.*locked' "$log"; then printf 'NZX_LOCK\n'
elif grep -Eqi 'Could not resolve|Temporary failure resolving|Name or service not known|unable to resolve' "$log"; then printf 'NZX_DNS\n'
elif grep -Eqi 'timed out|Connection failed|Could not connect|Network is unreachable|Connection refused|TLS|SSL' "$log"; then printf 'NZX_NETWORK\n'
elif grep -Eqi 'Permission denied|Operation not permitted|Read-only file system' "$log"; then printf 'NZX_PERMISSION\n'
elif grep -Eqi '404|403|Unable to locate package|No match for|not found|not signed|NO_PUBKEY|repository|repositories' "$log"; then printf 'NZX_REPOSITORY\n'
else printf 'NZX_PACKAGE\n'; fi
`
