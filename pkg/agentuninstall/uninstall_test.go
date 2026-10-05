package agentuninstall

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"io"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

const fixtureUUID = "12345678-1234-1234-1234-123456789abc"

func TestUninstallCommandsCoverSupportedPlatforms(t *testing.T) {
	for _, platform := range []string{"debian", "ubuntu", "alpine", "centos", "darwin", "freebsd", "Windows Server 2022"} {
		t.Run(platform, func(t *testing.T) {
			cmd, err := Command(fixtureUUID, platform)
			require.NoError(t, err)
			if strings.Contains(strings.ToLower(platform), "windows") {
				require.Less(t, len(cmd), 8001)
				payload := strings.Split(strings.Split(cmd, "FromBase64String('")[1], "'")[0]
				data, err := base64.StdEncoding.DecodeString(payload)
				require.NoError(t, err)
				reader, err := gzip.NewReader(bytes.NewReader(data))
				require.NoError(t, err)
				source, err := io.ReadAll(reader)
				require.NoError(t, err)
				require.NoError(t, reader.Close())
				require.Contains(t, string(source), fixtureUUID)
				require.Contains(t, string(source), "RegisterTaskDefinition")
				require.Contains(t, string(source), "-LiteralPath")
				require.NotContains(t, string(source), "-Recurse")
				require.NotContains(t, string(source), "__UUID__")
			} else {
				require.Contains(t, cmd, fixtureUUID)
				require.Contains(t, cmd, "systemd-run")
				require.Contains(t, cmd, "launchctl submit")
				require.Contains(t, cmd, "daemon -f")
				require.NotContains(t, cmd, "rm -rf")
				require.NotContains(t, cmd, "__UUID__")
			}
		})
	}
}
func TestUninstallRejectsInjectedIdentityAndSpecialNodes(t *testing.T) {
	for _, uuid := range []string{"", "../config", fixtureUUID + "'; rm anything", "$(id)"} {
		_, err := Command(uuid, "debian")
		require.Error(t, err)
	}
	for _, platform := range []string{"F50", "android", "openwrt", "routeros"} {
		_, err := Command(fixtureUUID, platform)
		require.Error(t, err)
	}
}
