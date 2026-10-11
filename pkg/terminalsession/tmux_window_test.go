package terminalsession

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestTmuxWindowValidation(t *testing.T) {
	row := Tmux{ID: "$2", Created: "99", Windows: []Window{{ID: "@1"}, {ID: "@2"}}}
	for _, name := range []string{"", " ", "a\nexit", strings.Repeat("中", 61)} {
		_, err := CreateTmuxWindowCommand(row, name)
		require.Error(t, err)
	}
	for _, id := range []string{"@9", "@1;exit", "0", ""} {
		_, err := EndTmuxWindowCommand(row, id)
		require.Error(t, err)
	}
	row.Windows = row.Windows[:1]
	_, err := EndTmuxWindowCommand(row, "@1")
	require.ErrorContains(t, err, "只剩一个窗口")
	_, err = ParseCreatedWindow("@1\nnoise")
	require.Error(t, err)
	require.NoError(t, ParseEndedWindow("NZX_WINDOW_ENDED\n"))
	require.Error(t, ParseEndedWindow(""))
}

func TestTmuxRealWindowCreateEndIsolationAndLastProtection(t *testing.T) {
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not installed")
	}
	dir, err := os.MkdirTemp("/tmp", "nz-window-test-")
	require.NoError(t, err)
	defer os.RemoveAll(dir)
	env := append(os.Environ(), "TMUX_TMPDIR="+dir, "TMUX=", "TERM=xterm-256color")
	execScript := func(script string) (string, error) {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, "sh", "-c", script)
		cmd.Env = env
		out, err := cmd.CombinedOutput()
		return string(out), err
	}
	run := func(script string) string { out, err := execScript(script); require.NoError(t, err, out); return out }
	defer func() { cmd := exec.Command("tmux", "kill-server"); cmd.Env = env; _ = cmd.Run() }()
	run("tmux new-session -d -s 111 -n main; tmux new-session -d -s 222 -n other")
	scan := func() []Tmux {
		rows, installed, err := ParseTmux(run(ListTmuxCommand))
		require.NoError(t, err)
		require.True(t, installed)
		return rows
	}
	get := func(name string) Tmux {
		for _, row := range scan() {
			if row.Name == name {
				return row
			}
		}
		t.Fatalf("missing %s", name)
		return Tmux{}
	}
	original := get("111")
	name := "任务 ' ; $(touch " + dir + "/unsafe)"
	create, err := CreateTmuxWindowCommand(original, name)
	require.NoError(t, err)
	id, err := ParseCreatedWindow(run(create))
	require.NoError(t, err)
	row := get("111")
	require.Len(t, row.Windows, 2)
	require.Equal(t, name, row.Windows[1].Name)
	require.Equal(t, id, row.Windows[1].ID)
	require.DirExists(t, dir)
	_, err = os.Stat(dir + "/unsafe")
	require.True(t, os.IsNotExist(err))
	// Creating is detached: the original active window is unchanged.
	require.Equal(t, original.Windows[0].ID, strings.TrimSpace(run("tmux display-message -p -t "+Quote(row.ID)+" '#{window_id}'")))
	marker := dir + "/survived"
	run("tmux send-keys -t " + Quote(row.Windows[0].ID) + " " + Quote("sleep 0.5; printf ok > "+Quote(marker)) + " Enter")
	end, err := EndTmuxWindowCommand(row, id)
	require.NoError(t, err)
	// Shared windows must not be killed in another session.
	other := get("222")
	run("tmux link-window -s " + Quote(row.ID+":"+id) + " -t " + Quote(other.ID+":"))
	require.ErrorContains(t, ParseEndedWindow(run(end)), "共享")
	require.Len(t, get("111").Windows, 2)
	require.Len(t, get("222").Windows, 2)
	run("tmux unlink-window -t " + Quote(other.ID+":"+id))
	require.NoError(t, ParseEndedWindow(run(end)))
	require.Len(t, get("111").Windows, 1)
	require.Len(t, get("222").Windows, 1)
	require.Eventually(t, func() bool { b, e := os.ReadFile(marker); return e == nil && string(b) == "ok" }, 3*time.Second, 20*time.Millisecond)
	// A stale 2-window snapshot cannot kill the last remaining live window.
	staleEnd, err := EndTmuxWindowCommand(row, row.Windows[0].ID)
	require.NoError(t, err)
	require.ErrorContains(t, ParseEndedWindow(run(staleEnd)), "只剩一个窗口")
	require.Len(t, get("111").Windows, 1)
	stale := get("111")
	stale.Created = "1"
	staleCreate, err := CreateTmuxWindowCommand(stale, "bad")
	require.NoError(t, err)
	_, err = execScript(staleCreate)
	require.Error(t, err)
	// Ending the entire session still closes all its windows and preserves other sessions.
	create, err = CreateTmuxWindowCommand(get("111"), "last")
	require.NoError(t, err)
	run(create)
	row = get("111")
	require.Len(t, row.Windows, 2)
	end, err = EndTmuxCommand(row)
	require.NoError(t, err)
	run(end)
	remaining := scan()
	require.Len(t, remaining, 1)
	require.Equal(t, "222", remaining[0].Name)
}
