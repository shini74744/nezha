#!/bin/sh
set -eu
umask 077
uuid='__UUID__'
dir=/opt/nezha/agent
binary="$dir/nezha-agent"
[ "$(id -u)" -eq 0 ] || { echo "NZ_UNINSTALL_ERROR: root required"; exit 1; }
os=$(uname -s)
case "$os" in Linux|Darwin|FreeBSD) ;; *) echo "NZ_UNINSTALL_ERROR: unsupported OS"; exit 1 ;; esac
[ -d "$dir" ] && [ ! -L "$dir" ] && [ -x "$binary" ] && [ ! -L "$binary" ] || { echo "NZ_UNINSTALL_ERROR: nonstandard installation"; exit 1; }
read_uuid() { awk '$1 == "uuid:" { gsub(/["\047\r]/, "", $2); print tolower($2); exit }' "$1"; }
config=
for file in "$dir"/*config*.yml; do
 [ -f "$file" ] && [ ! -L "$file" ] || continue
 if [ "$(read_uuid "$file")" = "$uuid" ]; then
  [ -z "$config" ] || { echo "NZ_UNINSTALL_ERROR: ambiguous UUID"; exit 1; }
  config=$file
 fi
done
[ -n "$config" ] || { echo "NZ_UNINSTALL_ERROR: UUID does not match installation"; exit 1; }
# Launch outside the Agent service/cgroup. Never execute cleanup inline.
launcher=
case "$os" in
 Linux)
  if [ -d /run/systemd/system ]; then
   command -v systemd-run >/dev/null || exit 1
   launcher=systemd
  else
   command -v setsid >/dev/null || exit 1
   launcher=setsid
  fi ;;
 Darwin) command -v launchctl >/dev/null; launcher=launchd ;;
 FreeBSD) command -v daemon >/dev/null; launcher=daemon ;;
esac
work=$(mktemp -d /tmp/nezha-uninstall.XXXXXXXX)
job="nezha-uninstall-$(basename "$work" | tr '.' '-')"
# The worker carries only a UUID, not panel credentials.
cat > "$work/run.sh" <<'NZ_CLEANUP_WORKER'
#!/bin/sh
set -eu
umask 077
uuid=$1
work=$2
job=$3
launcher=$4
dir=/opt/nezha/agent
binary="$dir/nezha-agent"
read_uuid() { awk '$1 == "uuid:" { gsub(/["\047\r]/, "", $2); print tolower($2); exit }' "$1"; }
# Signal only launch acknowledgement, then allow RequestTask to send its reply.
: > "$work/ready"
sleep 3
[ -d "$dir" ] && [ ! -L "$dir" ] && [ -x "$binary" ] && [ ! -L "$binary" ] || exit 1
config=
for file in "$dir"/*config*.yml; do
 [ -f "$file" ] && [ ! -L "$file" ] || continue
 if [ "$(read_uuid "$file")" = "$uuid" ]; then
  [ -z "$config" ] || exit 1
  config=$file
 fi
done
[ -n "$config" ] || exit 1
# Fail closed on stop/unregister errors; blacklist still prevents re-registration.
"$binary" service -c "$config" stop
"$binary" service -c "$config" uninstall
rm -f -- "$config"
# Remove only this UUID's known backup contents, never recurse into directories.
for backup in "$dir"/backup.*; do
 [ -d "$backup" ] && [ ! -L "$backup" ] || continue
 file="$backup/config.yml"
 [ -f "$file" ] && [ ! -L "$file" ] || continue
 [ "$(read_uuid "$file")" = "$uuid" ] || continue
 rm -f -- "$file"
 if [ -f "$backup/nezha-agent" ] && [ ! -L "$backup/nezha-agent" ]; then rm -f -- "$backup/nezha-agent"; fi
 rmdir -- "$backup" 2>/dev/null || true
done
shared=0
for file in "$dir"/*config*.yml; do
 if [ -e "$file" ] || [ -L "$file" ]; then shared=1; fi
done
if [ "$shared" -eq 0 ]; then
 rm -f -- "$binary"
 # Only known installer files inside the install directory are considered.
 # Downloaded copies in arbitrary home/current directories are not guessed.
 for file in "$dir/agent.sh" "$dir/install.sh"; do
  [ -f "$file" ] && [ ! -L "$file" ] || continue
  if grep -q 'NZ_CLIENT_SECRET' "$file" && grep -q 'nezha-agent' "$file"; then rm -f -- "$file"; fi
 done
 rmdir -- "$dir" 2>/dev/null || true
fi
rm -f -- "$work/run.sh" "$work/ready" "$work/worker.log"
rmdir -- "$work" 2>/dev/null || true
if [ "$launcher" = launchd ]; then launchctl remove "$job"; fi
NZ_CLEANUP_WORKER
chmod 700 "$work/run.sh"
case "$launcher" in
 systemd) systemd-run --quiet --unit="$job" /bin/sh "$work/run.sh" "$uuid" "$work" "$job" "$launcher" ;;
 setsid) setsid /bin/sh "$work/run.sh" "$uuid" "$work" "$job" "$launcher" </dev/null >"$work/worker.log" 2>&1 & ;;
 launchd) launchctl submit -l "$job" -o "$work/worker.log" -e "$work/worker.log" -- /bin/sh "$work/run.sh" "$uuid" "$work" "$job" "$launcher" ;;
 daemon) daemon -f /bin/sh "$work/run.sh" "$uuid" "$work" "$job" "$launcher" >"$work/worker.log" 2>&1 ;;
esac
attempt=0
while [ ! -f "$work/ready" ]; do
 attempt=$((attempt + 1))
 [ "$attempt" -le 5 ] || { echo "NZ_UNINSTALL_ERROR: worker did not start"; exit 1; }
 sleep 1
done
printf '%s\n' "NZ_UNINSTALL_STARTED"
