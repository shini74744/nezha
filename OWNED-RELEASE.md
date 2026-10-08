# shini74744 Agent

Based on nezhahq/agent v2.3.5 (agent-v1.0.1~2^2~14), under the original Apache-2.0 license.

This distribution uses only **shini74744/agent** for installation packages, automatic updates and dashboard-triggered upgrades.
Legacy use_gitee_to_upgrade/use_atomgit_to_upgrade options are accepted for configuration compatibility but ignored for source selection.
If GitHub is unavailable, the operation fails without an upstream fallback. A SHA256 asset is required for every update.

- Linux/macOS/FreeBSD installer: scripts/install.sh
- Windows installer: scripts/install.ps1
- Binary assets: https://github.com/shini74744/agent/releases/latest
- The dashboard supplies NZ_SERVER, NZ_CLIENT_SECRET, NZ_TLS and optionally NZ_UUID.
- Run installers with administrator/root privileges. POSIX requires curl, unzip and a SHA256 utility.
- Installers preserve the existing config and UUID and keep a local backup before replacement.
- Running the POSIX script without arguments (or with `install`) is an explicit installation/reinstallation action. The repository alone does not change already-installed official Agents.
- POSIX uninstall: `./agent.sh uninstall` (or `sh agent.sh uninstall`). Uses sudo when needed, stops/unregisters services for top-level `/opt/nezha/agent/*config*.yml` files, and deletes each configuration only after its service uninstalls successfully. This removes UUID/connection settings: back them up first if needed.
- Uninstall does not download packages or require installation settings/tools. The Agent binary, historical backup directories and dashboard data remain untouched. It does not recurse into backups or follow symlinked Agent directories, binaries or configurations. Missing configuration files are a reported no-op; orphaned services require separate inspection. Failures return nonzero and preserve configurations when service removal fails.
- The uninstall argument requires the updated script; replace previously downloaded copies first. Do not probe old scripts with `uninstall` or `--help`: they ignore arguments and can reinstall the Agent. In the updated script, `--help` lists supported actions and unknown/extra arguments fail before installation.
- Installer regression tests (no real services/network): `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest -v scripts.test_install_uninstall scripts.test_install_elevation scripts.test_install_output scripts.test_install_progress release.test_installers`. Tests require Python 3, sh/dash/bash/BusyBox, and the standard installation utilities.
- Existing official Agents still use their old updater until deliberately reinstalled with this distribution. Do not use the old dashboard upgrade button as a source migration.

Publishing: run `go test -mod=readonly ./...`, then `bash release/build.sh VERSION /absolute/output/path`. This builds all 18 supported OS/architecture packages and checksum assets. Create a v-prefixed semantic-version tag and a draft GitHub release, upload the zip/checksum assets, verify them, then publish. GitHub Actions is not configured because the current publishing credential does not have workflow permission.
Internal Go module paths remain unchanged for source compatibility; they are not runtime download URLs.

## v2.3.7 connectivity and dual-stack reporting

- Independent HTTPS destinations no longer serialize their TCP/TLS handshakes behind the shared connection cache lock.
- HTTP/1 and HTTP/2 dial and TLS handshake cancellation follows the originating request. Failed TLS sockets are closed.
- Dashboard connectivity tasks (reserved ID bit 62) have a three-second request deadline including response-body reads. Ordinary service monitors retain the existing 30-second timeout.
- IPv4 and IPv6 are tracked separately for IP-report change detection, including appearance and disappearance of either family. Failed reports remain dirty until acknowledged.
- No connection credentials, UUIDs, network routes or firewall rules are changed by this release.

## v2.3.8 disk read/write reporting

- Adds whole-machine disk read/write throughput in bytes per second, computed from cumulative OS counters and actual elapsed sample time.
- Linux aggregates whole leaf block devices, excluding partitions, loop/RAM devices and stacked mappings to avoid duplicate I/O accounting. Other platforms use gopsutil device counters when supported.
- First sample, missing OS counters and probe errors are explicitly unavailable, distinct from valid idle zero rates. Counter resets and device hotplug cannot wrap into huge throughput values.
- Adds protobuf State fields 19–21 without changing existing numbers. Old dashboards ignore these fields; older Agents remain compatible with upgraded dashboards.
- Includes concurrent sampler/race, reset/error/idle, Linux device selection and model/report mapping tests. Existing capacity collection, credentials, UUIDs, service settings and update source are unchanged.
