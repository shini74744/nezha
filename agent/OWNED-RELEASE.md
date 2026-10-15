# shini74744 Agent

Based on nezhahq/agent v2.3.5 (4979248b05875638534934938623ea5b32edfeca), under the original Apache-2.0 license.

This distribution uses only **shini74744/nezha**, using the separate Agent channel for installation packages, automatic updates and dashboard-triggered upgrades.
Legacy use_gitee_to_upgrade/use_atomgit_to_upgrade options are accepted for configuration compatibility but ignored for source selection.
If GitHub is unavailable, the operation fails without an upstream fallback. A SHA256 asset is required for every update.

- Linux/macOS/FreeBSD installer: scripts/install.sh
- Windows installer: scripts/install.ps1
- Binary assets: https://github.com/shini74744/nezha/releases
- The dashboard supplies DDNZ_SERVER, DDNZ_CLIENT_SECRET, DDNZ_TLS and DDNZ_UUID as a matched, per-server credential pair.
- Run installers with administrator/root privileges. POSIX requires curl, unzip and a SHA256 utility.
- Installers preserve the existing config and UUID and keep a local backup before replacement.
- Running the POSIX script without arguments (or with `install`) is an explicit installation/reinstallation action. The repository alone does not change already-installed official Agents.
- POSIX uninstall: `./DDnezha.sh uninstall` (or `sh DDnezha.sh uninstall`). Uses sudo when needed, stops/unregisters services for top-level `/opt/DDnezha/*config*.yml` files, and deletes each configuration only after its service uninstalls successfully. This removes UUID/connection settings: back them up first if needed.
- Uninstall does not download packages or require installation settings/tools. The Agent binary, historical backup directories and dashboard data remain untouched. It does not recurse into backups or follow symlinked Agent directories, binaries or configurations. Missing configuration files are a reported no-op; orphaned services require separate inspection. Failures return nonzero and preserve configurations when service removal fails.
- The uninstall argument requires the updated script; replace previously downloaded copies first. Do not probe old scripts with `uninstall` or `--help`: they ignore arguments and can reinstall the Agent. In the updated script, `--help` lists supported actions and unknown/extra arguments fail before installation.
- Installer regression tests (no real services/network): `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest -v scripts.test_install_uninstall scripts.test_install_elevation scripts.test_install_output scripts.test_install_progress scripts.test_install_isolation release.test_installers`. Tests require Python 3, sh/dash/bash/BusyBox, and the standard installation utilities.
- Existing official Agents still use their old updater until deliberately reinstalled with this distribution. Do not use the old dashboard upgrade button as a source migration.

Publishing: run `go test -mod=readonly ./...`, then `bash release/build.sh VERSION /absolute/output/path`. This builds all 18 supported OS/architecture packages, checksum assets and `agent-release.json`. The root `.github/workflows/agent-release.yml` runs on `agent-vX.Y.Z` tags: Linux/Windows/macOS tests must pass before all 18 build jobs run. Native Linux amd64, Windows amd64 and macOS arm64 packages also execute `-v`. Download artifacts, verify ZIP contents/checksums/manifest commit, aggregate `checksums.txt`, upload to a draft, verify fresh downloads, then publish with `--latest=false`. Do not use the repository-wide Latest for Agent discovery. Publish and verify the immutable release before activating `release/agent-version.txt` on main. See [unified repository](../docs/unified-repository.md). No workflow publishes automatically.
Internal Go module paths remain unchanged for source compatibility; they are not runtime download URLs.

## Pending v1.0.2 DDnezha lifecycle isolation

The executable and service are `DDnezha` (`DDnezha.exe` on Windows); installers use `/opt/DDnezha` or `C:\DDnezha`. ZIP assets are `DDnezha_OS_ARCH.zip`, with channel `DDnezha-agent-v1`. Config YAML fields and the communication protocol are unchanged. Only `DDNZ_*` environment settings are accepted; upstream `NZ_*` settings are ignored.

An adjacent `.DDnezha-owned` marker containing `DDnezha` is required before service/configuration changes or self-update. The installer creates it. Marker checks are accidental-overlap protection, not a security boundary against administrators. Service names never derive from an arbitrary executable basename. Windows also supports `.\DDnezha.ps1 uninstall`.

The v1.0.1 updater requires its older channel and asset names, so it rejects this new release instead of writing it into the shared legacy installation. Existing nodes need deliberate migration with per-node UUID/key and other configuration preserved. Do not overwrite the legacy executable, use symlinks to bridge directories, or remove official services. See [migration and isolation boundaries](../docs/ddnezha-isolation.md). This source change is not evidence of publication or fleet migration.

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

## v1.0.0 owned version series

This is a formal renumbering of this distribution, not a rollback to upstream v1.0.0. All v2.3.8 features remain. Host protobuf field 12 adds explicit server-transfer-v1 and mcp-v1 capabilities so the companion dashboard v0.0.1 does not mistake the lower number for missing features. Capabilities never grant authentication or task permissions.

Upgrade the dashboard first. Preserve every node's own UUID/key and configuration; no reinstall or shared credential is needed. After backup and validation, remove only the old v2.3.6/v2.3.7/v2.3.8 GitHub Releases, keeping tags and source history. Those old updaters choose the greatest semantic version and replace on version inequality, so removing the old releases allows the authorized transition to 1.0.0. Offline nodes and configurations disabling auto-update remain pending.

The historical v1.0.0 updater followed the old repository's designated Latest. From v1.0.1, updaters read the unified repository's `release/agent-version.txt` and fetch only its exact `agent-vX.Y.Z` release; they require an agent-release.json channel manifest (schema 1, channel shini74744-agent-v1, matching version, 40-hex source commit), and do not downgrade during normal automatic updates. A platform ZIP and its SHA256 sidecar must both exist; checksum validation happens before extraction and atomic replacement. Only the expected single executable is accepted. Network, manifest, checksum or replacement errors fail closed without fallback. Dashboard-forced updates retain the existing disable_force_update gate.

Deleting a Release does not erase its Git tag. Restoring old releases can alter old updaters' version selection again and must be coordinated with update controls. Keep release metadata and verified asset backups outside the source tree.
