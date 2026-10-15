#!/bin/sh
# Low-level, controller-driven migration of ONE pre-verified systemd instance.
# The controller must match panel UUID, secret and endpoint before staging.
# No discovery, downloads, whole-directory uninstall or shared-binary overwrite.
set -eu
umask 077
[ "$#" -eq 8 ] || { echo "Expected 8 verified migration arguments" >&2; exit 2; }
old_binary=$1 old_config=$2 old_unit=$3 old_pid=$4 old_hash=$5 config_hash=$6 new_hash=$7 stage=$8
new_dir=/opt/DDnezha
new_binary=$new_dir/DDnezha
new_config=$new_dir/config.yml
new_unit=DDnezha.service
case "$old_binary" in /opt/nezha/agent/nezha-agent) ;; *) exit 2;; esac
case "$old_config" in /opt/nezha/agent/*config*.yml) ;; *) exit 2;; esac
case "$old_unit" in nezha-agent.service|nezha-agent-*.service) ;; *) exit 2;; esac
case "$old_unit" in *[!A-Za-z0-9.-]*) exit 2;; esac
case "$old_pid" in ''|*[!0-9]*) exit 2;; esac
case "$stage" in /opt/DDnezha/migration-*) ;; *) exit 2;; esac
[ "$(dirname "$stage")" = "$new_dir" ] || exit 2
[ "$(id -u)" = 0 ] || exit 2
for path in "$old_binary" "$old_config" "$new_binary" "$new_config" "$new_dir/.DDnezha-owned" "$stage"; do
 [ ! -L "$path" ] && [ "$(readlink -f "$path")" = "$path" ] || exit 2
done
[ "$(head -1 "$new_dir/.DDnezha-owned")" = DDnezha ] || exit 2
[ -d "$stage" ] && [ -f "$old_config" ] && [ -f "$new_config" ] || exit 2
[ ! -e "$stage/state" ] && [ ! -e "$stage/confirmed" ] || exit 2
hash() { sha256sum "$1" | cut -d ' ' -f1; }
[ "$(hash "$old_binary")" = "$old_hash" ] || exit 2
[ "$(hash "$old_config")" = "$config_hash" ] || exit 2
[ "$(hash "$new_config")" = "$config_hash" ] || exit 2
[ "$(hash "$new_binary")" = "$new_hash" ] || exit 2
[ "$(systemctl show "$old_unit" -p MainPID --value)" = "$old_pid" ] || exit 2
[ "$(readlink -f "/proc/$old_pid/exe")" = "$old_binary" ] || exit 2
active_config=$(tr '\000' '\n' < "/proc/$old_pid/cmdline" | awk 'p {print; exit} $0=="-c" || $0=="--config" {p=1}')
[ -n "$active_config" ] || active_config="$(dirname "$old_binary")/config.yml"
case "$active_config" in /*) ;; *) active_config="$(readlink -f "/proc/$old_pid/cwd")/$active_config";; esac
[ "$(readlink -f "$active_config")" = "$old_config" ] || exit 2
[ "$(systemctl show "$new_unit" -p LoadState --value)" = not-found ] || exit 2
# Fail closed on externally managed units; migrate those only after manual review.
[ -z "$(systemctl show "$old_unit" -p DropInPaths --value)" ] || exit 2
[ ! -e "/etc/sysconfig/${old_unit%.service}" ] || exit 2
systemctl cat "$old_unit" > "$stage/old-unit.txt"
cp -p "$old_config" "$stage/config.previous"
chmod 600 "$stage/config.previous"
enabled=$(systemctl is-enabled "$old_unit" 2>/dev/null || true)
case "$enabled" in enabled|disabled|static) ;; *) exit 2;; esac
printf '%s\n' "$enabled" > "$stage/old-enabled"
changed=0
committed=0
rollback() {
 result=$?
 trap - EXIT HUP INT TERM
 if [ "$changed" = 1 ] && [ "$committed" = 0 ]; then
  systemctl stop "$new_unit" >/dev/null 2>&1 || true
  "$new_binary" service -c "$new_config" uninstall >/dev/null 2>&1 || true
  if [ "$enabled" = enabled ]; then systemctl enable "$old_unit"; fi
  if systemctl start "$old_unit"; then
   printf '%s\n' ROLLED_BACK > "$stage/state"
  else
   printf '%s\n' ROLLBACK_FAILED > "$stage/state"
  fi
 fi
 exit "$result"
}
trap rollback EXIT
trap 'exit 1' HUP INT TERM
# Backups are complete before the exact old unit is stopped.
changed=1
systemctl stop "$old_unit"
if [ "$enabled" = enabled ]; then systemctl disable "$old_unit"; fi
[ "$(systemctl show "$old_unit" -p MainPID --value)" = 0 ]
"$new_binary" service -c "$new_config" install
systemctl is-active --quiet "$new_unit"
printf '%s\n' WAITING_FOR_PANEL_VERIFICATION > "$stage/state"
# A separately authenticated controller verifies identity, live report, running
# binary hash and every unrelated instance, then writes this private marker.
attempt=0
while [ "$attempt" -lt 180 ]; do
 if [ -f "$stage/abort" ]; then exit 1; fi
 if [ -f "$stage/confirmed" ] && [ ! -L "$stage/confirmed" ]; then
  [ "$(cat "$stage/confirmed")" = "$new_hash" ] || exit 1
  [ "$(hash "$old_binary")" = "$old_hash" ] || exit 1
  [ "$(hash "$old_config")" = "$config_hash" ] || exit 1
  systemctl is-active --quiet "$new_unit"
  committed=1
  printf '%s\n' COMMITTED > "$stage/state"
  # Keep the exact old unit disabled and its files for rollback. Other old
  # configs, units and the shared binary have not been modified or removed.
  exit 0
 fi
 attempt=$((attempt + 1))
 sleep 1
done
exit 1
