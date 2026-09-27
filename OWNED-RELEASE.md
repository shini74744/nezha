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
- Running these scripts is an explicit installation/reinstallation action. The repository alone does not change already-installed official Agents.
- Existing official Agents still use their old updater until deliberately reinstalled with this distribution. Do not use the old dashboard upgrade button as a source migration.

Publishing: create a v-prefixed semantic-version tag. The release workflow builds all 18 supported OS/architecture packages and checksum assets, runs tests, and creates a **draft** release. Review the assets and publish the draft to make it the update target.
Internal Go module paths remain unchanged for source compatibility; they are not runtime download URLs.
