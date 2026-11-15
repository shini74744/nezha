//go:build !windows

package panelbackup

import (
	"crypto/sha256"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestReceiverInstallerDownloadFallbackAndVerification(t *testing.T) {
	if _, err := exec.LookPath("sha256sum"); err != nil {
		t.Skip("Linux receiver requires sha256sum")
	}
	for _, mode := range []string{"primary", "fallback", "failed", "mismatch"} {
		t.Run(mode, func(t *testing.T) {
			dir := t.TempDir()
			bin := filepath.Join(dir, "bin")
			require.NoError(t, os.Mkdir(bin, 0700))
			fixture := filepath.Join(dir, "fixture.sh")
			content := []byte("#!/bin/sh\nprintf '%s' \"$DDNZ_BACKUP_DIRECTORY\" > \"$TEST_MARKER\"\n")
			require.NoError(t, os.WriteFile(fixture, content, 0600))
			curl := `#!/bin/sh
set -eu
url=""
out=""
while [ "$#" -gt 0 ]; do
 case "$1" in
  https://*) url="$1"; shift;;
  -o) out="$2"; shift 2;;
  *) shift;;
 esac
done
printf '%s\n' "$url" >> "$TEST_DOWNLOADS"
if [ "$TEST_MODE" = failed ]; then echo 'HTTP 503 test failure' >&2; exit 22; fi
case "$url" in
 *releases/download*) if [ "$TEST_MODE" = fallback ]; then echo 'HTTP 503 primary' >&2; exit 22; fi;;
esac
cp "$TEST_FIXTURE" "$out"
`
			require.NoError(t, os.WriteFile(filepath.Join(bin, "curl"), []byte(curl), 0700))
			target := "/fixture with quote'/$(touch should-not-exist)"
			command := receiverInstallCommand("ddnb_123456789abc_11223344", target, "ssh-ed25519 fixture", 2022)
			digest := fmt.Sprintf("%x", sha256.Sum256(content))
			if mode == "mismatch" {
				digest = strings.Repeat("0", 64)
			}
			command = strings.ReplaceAll(command, receiverInstallerSHA256, digest)
			c := exec.Command("sh", "-c", command)
			c.Dir = dir
			c.Env = append(os.Environ(), "PATH="+bin+string(os.PathListSeparator)+os.Getenv("PATH"), "TEST_MODE="+mode, "TEST_FIXTURE="+fixture, "TEST_MARKER="+filepath.Join(dir, "installed"), "TEST_DOWNLOADS="+filepath.Join(dir, "downloads"))
			output, err := c.CombinedOutput()
			if mode == "failed" || mode == "mismatch" {
				require.Error(t, err)
				require.NoFileExists(t, filepath.Join(dir, "installed"))
			} else {
				require.NoError(t, err, string(output))
				got, e := os.ReadFile(filepath.Join(dir, "installed"))
				require.NoError(t, e)
				require.Equal(t, target, string(got))
			}
			calls, e := os.ReadFile(filepath.Join(dir, "downloads"))
			require.NoError(t, e)
			require.Contains(t, string(calls), "/releases/download/backup-"+ReceiverVersion+"/install.sh")
			if mode == "fallback" || mode == "failed" {
				require.Contains(t, string(calls), "raw.githubusercontent.com")
				require.Contains(t, string(output), "503")
			}
			require.NoFileExists(t, filepath.Join(dir, "should-not-exist"))
		})
	}
}
