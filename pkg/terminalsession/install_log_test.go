package terminalsession

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestInstallLogCommandsRejectUntrustedPaths(t *testing.T) {
	for _, token := range []string{"", "../etc", strings.Repeat("a", 32) + ";id", strings.Repeat("a", 33), strings.Repeat("G", 32)} {
		_, _, _, err := InstallTmuxLoggedCommands(token)
		require.Error(t, err)
	}
}
func TestInstallLogIsAvailableBeforeCommandFinishesAndCleaned(t *testing.T) {
	bin := t.TempDir()
	for _, name := range []string{"sh", "timeout", "grep", "mkdir", "rm", "rmdir", "tail", "chmod", "sleep"} {
		source, err := exec.LookPath(name)
		require.NoError(t, err)
		require.NoError(t, os.Symlink(source, filepath.Join(bin, name)))
	}
	require.NoError(t, os.WriteFile(filepath.Join(bin, "id"), []byte("#!/bin/sh\nprintf '0\\n'\n"), 0700))
	script := "#!/bin/sh\nprintf 'Downloading packages 45%%\\n'\nsleep 0.4\ncase \"$*\" in *'install -y --no-install-recommends tmux'*) printf 'Setting up tmux...\\n'; printf '#!/bin/sh\\nprintf tmux-test\\n' > " + Quote(filepath.Join(bin, "tmux")) + "; chmod 700 " + Quote(filepath.Join(bin, "tmux")) + ";; esac\n"
	require.NoError(t, os.WriteFile(filepath.Join(bin, "apt-get"), []byte(script), 0700))
	token := make([]byte, 16)
	_, err := rand.Read(token)
	require.NoError(t, err)
	install, read, cleanup, err := InstallTmuxLoggedCommands(hex.EncodeToString(token))
	require.NoError(t, err)
	require.NotContains(t, install, "mktemp")
	require.NotContains(t, install, "upgrade")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	run := func(command string) ([]byte, error) {
		c := exec.CommandContext(ctx, "/bin/sh", "-c", command)
		c.Env = []string{"PATH=" + bin}
		return c.CombinedOutput()
	}
	t.Cleanup(func() { _, _ = run(cleanup) })
	cmd := exec.CommandContext(ctx, "/bin/sh", "-c", install)
	cmd.Env = []string{"PATH=" + bin}
	var output strings.Builder
	cmd.Stdout = &output
	cmd.Stderr = &output
	require.NoError(t, cmd.Start())
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	require.Eventually(t, func() bool { b, e := run(read); return e == nil && strings.Contains(string(b), "45%") }, time.Second, 10*time.Millisecond)
	select {
	case <-done:
		t.Fatal("log was not delivered while installer was running")
	default:
	}
	require.NoError(t, <-done)
	require.Equal(t, "NZX_INSTALLED", strings.TrimSpace(output.String()))
	log, err := run(read)
	require.NoError(t, err)
	require.Contains(t, string(log), "Setting up tmux")
	_, err = run(cleanup)
	require.NoError(t, err)
	log, err = run(read)
	require.NoError(t, err)
	require.Empty(t, log)
}
