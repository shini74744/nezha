package terminalsession

import (
	"context"
	"github.com/stretchr/testify/require"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestInstallScriptUsesOnlyTmuxAndClassifiesFailure(t *testing.T) {
	for _, failure := range []string{"", "Temporary failure resolving example.invalid", "Could not get lock", "No space left on device", "Connection timed out"} {
		t.Run(failure, func(t *testing.T) {
			bin := t.TempDir()
			trace := filepath.Join(bin, "args")
			for _, name := range []string{"sh", "timeout", "grep", "mktemp", "rm", "chmod"} {
				source, e := exec.LookPath(name)
				require.NoError(t, e)
				require.NoError(t, os.Symlink(source, filepath.Join(bin, name)))
			}
			require.NoError(t, os.WriteFile(filepath.Join(bin, "id"), []byte("#!/bin/sh\nprintf '0\\n'\n"), 0700))
			script := "#!/bin/sh\nprintf '%s\\n' \"$*\" >> " + Quote(trace) + "\n"
			if failure != "" {
				script += "printf '%s\\n' " + Quote(failure) + " >&2\nexit 1\n"
			} else {
				script += "case \"$*\" in *'install -y --no-install-recommends tmux'*) printf '#!/bin/sh\\nprintf tmux-test\\n' > " + Quote(filepath.Join(bin, "tmux")) + "; chmod 700 " + Quote(filepath.Join(bin, "tmux")) + ";; esac\n"
			}
			require.NoError(t, os.WriteFile(filepath.Join(bin, "apt-get"), []byte(script), 0700))
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, "/bin/sh", "-c", InstallTmuxCommand)
			cmd.Env = []string{"PATH=" + bin}
			b, e := cmd.CombinedOutput()
			require.NoError(t, e, string(b))
			codes := map[string]string{"": "NZX_INSTALLED", "Temporary failure resolving example.invalid": "NZX_DNS", "Could not get lock": "NZX_LOCK", "No space left on device": "NZX_DISK", "Connection timed out": "NZX_NETWORK"}
			require.Equal(t, codes[failure], strings.TrimSpace(string(b)))
			args, e := os.ReadFile(trace)
			require.NoError(t, e)
			require.NotContains(t, string(args), "upgrade")
			if failure == "" {
				require.Contains(t, string(args), "install -y --no-install-recommends tmux")
			}
		})
	}
}
