package terminalsession

import (
	"context"
	"github.com/stretchr/testify/require"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

func TestTmuxRejectsNamesAndTargets(t *testing.T) {
	for _, name := range []string{"", "a:b", "a.b", "x\nquit", "\x00"} {
		_, e := CreateTmuxCommand(name, "main")
		require.Error(t, e)
	}
	_, e := VerifyTmuxCommand(Tmux{ID: "$1;touch /tmp/no", Created: "3"})
	require.Error(t, e)
	_, e = AttachTmuxCommand(Tmux{ID: "$1", Created: "3"}, "@9")
	require.Error(t, e)
	require.Equal(t, "'a'\"'\"'b'", Quote("a'b"))
	for _, raw := range []string{"", "NZX_OK\nNZX_LIMIT\nNZX_END", "NZX_OK\nS|$1|3|***\nNZX_END", "NZX_OK\nS|$1|3|YQ==\nS|$1|3|YQ==\nNZX_END"} {
		_, _, e = ParseTmux(raw)
		require.Error(t, e)
	}
}
func TestTmuxRealMultipleManualSessionsWindowNamesAndIndependentTask(t *testing.T) {
	if _, e := exec.LookPath("tmux"); e != nil {
		t.Skip("tmux not installed")
	}
	// Isolated default socket: no access to the operator's real sessions.
	dir, e := os.MkdirTemp("/tmp", "nz-tmux-test-")
	require.NoError(t, e)
	defer os.RemoveAll(dir)
	env := append(os.Environ(), "TMUX_TMPDIR="+dir, "TMUX=", "TERM=xterm-256color")
	run := func(script string) string {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		c := exec.CommandContext(ctx, "sh", "-c", script)
		c.Env = env
		b, e := c.CombinedOutput()
		require.NoError(t, e, string(b))
		return string(b)
	}
	defer func() { c := exec.Command("tmux", "kill-server"); c.Env = env; _ = c.Run() }()
	run("tmux new-session -d -s manual -n hand")
	name := "build ' 引号 ; $(echo nope)"
	command, e := CreateTmuxCommand(name, "任务 窗口")
	require.NoError(t, e)
	run(command)
	rows, installed, e := ParseTmux(run(ListTmuxCommand))
	require.NoError(t, e)
	require.True(t, installed)
	require.Len(t, rows, 2)
	var created Tmux
	for _, row := range rows {
		if row.Name == name {
			created = row
		}
	}
	require.NotEmpty(t, created.ID, "rows: %+v", rows)
	require.Equal(t, "任务 窗口", created.Windows[0].Name)
	run("tmux new-window -d -t " + Quote(created.ID) + " -n second")
	rows, _, e = ParseTmux(run(ListTmuxCommand))
	require.NoError(t, e)
	for _, row := range rows {
		if row.ID == created.ID {
			created = row
		}
	}
	require.Len(t, created.Windows, 2)
	// Exact window-id target accepted without ambiguity.
	run("tmux select-window -t " + Quote(created.ID+":"+created.Windows[1].ID))
	attach, e := AttachTmuxCommand(created, created.Windows[1].ID)
	require.NoError(t, e)
	require.Contains(t, attach, "attach-session")
	marker := dir + "/finished"
	if _, e := exec.LookPath("script"); e == nil {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		client := exec.CommandContext(ctx, "script", "-q", "-c", "tmux -u attach-session -t "+Quote(created.ID), "/dev/null")
		client.Env = env
		input, e := client.StdinPipe()
		require.NoError(t, e)
		defer input.Close()
		require.NoError(t, client.Start())
		require.Eventually(t, func() bool {
			return strings.TrimSpace(run("tmux list-clients -t "+Quote(created.ID)+" -F '#{client_pid}'")) != ""
		}, time.Second, 20*time.Millisecond)
		run("tmux send-keys -t " + Quote(created.Windows[0].ID) + " " + Quote("sleep 0.4; printf complete > "+Quote(marker)) + " Enter")
		run("tmux detach-client -s " + Quote(created.ID))
		require.NoError(t, client.Wait())
	} else {
		t.Fatal("script utility required for actual PTY detach coverage")
	}

	require.Eventually(t, func() bool { b, e := os.ReadFile(marker); return e == nil && string(b) == "complete" }, 3*time.Second, 20*time.Millisecond)
	// A stale fingerprint cannot end the selected session.
	stale := created
	stale.Created = "1"
	verify, e := VerifyTmuxCommand(stale)
	require.NoError(t, e)
	require.Equal(t, "rejected", strings.TrimSpace(run(verify+" || printf rejected")))
	kill, e := EndTmuxCommand(created)
	require.NoError(t, e)
	run(kill)
	rows, _, e = ParseTmux(run(ListTmuxCommand))
	require.NoError(t, e)
	require.Len(t, rows, 1)
	require.Equal(t, "manual", rows[0].Name)
}
func TestInstallerHasNoFullSystemUpgrade(t *testing.T) {
	for _, bad := range []string{"apt-get upgrade", "dist-upgrade", "full-upgrade", "dnf upgrade", "yum update", "pacman -Syu", "curl", "wget"} {
		require.NotContains(t, InstallTmuxCommand, bad)
	}
	require.Contains(t, InstallTmuxCommand, "install -y --no-install-recommends tmux")
	require.Contains(t, InstallTmuxCommand, "timeout -s TERM 300")
}
