package controller

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
)

func TestTmuxLogSanitizationAndBounds(t *testing.T) {
	raw := "\x1b[31mGet 45% https://user:pass@example.invalid/file?token=secret\x1b[0m\nAuthorization: Bearer abc\npassword=hidden\nSetting up tmux...\n"
	clean := cleanInstallLog(raw)
	require.Contains(t, clean, "45%")
	require.Contains(t, clean, "Setting up tmux")
	for _, secret := range []string{"user:pass", "secret", "Bearer", "hidden", "\x1b"} {
		require.NotContains(t, clean, secret)
	}
	clean = cleanInstallLog(strings.Repeat("credential", 5000) + "\nOK\n")
	require.LessOrEqual(t, len(clean), 32768)
	require.Equal(t, "OK\n", clean)
	require.NotContains(t, cleanInstallLog(strings.Repeat("x", 50000)), "xxx")
}
func TestTmuxInstallStreamsProgressAndRetainsFinalLog(t *testing.T) {
	server := &model.Server{}
	job := &tmuxInstallJob{View: tmuxInstallView{State: "running"}}
	release := make(chan struct{})
	done := make(chan struct{})
	var released bool
	installer := func(ctx context.Context, _ *model.Server, _ string) (string, error) {
		select {
		case <-release:
			return "NZX_INSTALLED", nil
		case <-ctx.Done():
			return "", ctx.Err()
		}
	}
	logReader := func(_ context.Context, _ *model.Server, cmd string) (string, error) {
		if cmd == "cleanup" {
			return "", nil
		}
		if !released {
			close(release)
			released = true
		}
		return "Downloading 45%\nSetting up tmux\n", nil
	}
	go func() {
		executeTmuxInstall(job, server, "install", "read", "cleanup", installer, logReader)
		close(done)
	}()
	require.Eventually(t, func() bool {
		tmuxInstalls.Lock()
		defer tmuxInstalls.Unlock()
		return strings.Contains(job.View.Log, "45%")
	}, 3*time.Second, 10*time.Millisecond)
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("installer did not finish")
	}
	tmuxInstalls.Lock()
	defer tmuxInstalls.Unlock()
	require.Equal(t, "done", job.View.State)
	require.Contains(t, job.View.Log, "Setting up tmux")
}
func TestTmuxInstallLogsAreRestrictedToJobOwner(t *testing.T) {
	m := sessionFixture(t)
	server, _ := singleton.ServerShared.Get(7)
	server.SetTaskStream(&failingRequestTaskStream{})
	tmuxInstalls.Lock()
	tmuxInstalls.rows[m.ServerUUID] = &tmuxInstallJob{Owner: 100, Started: time.Now(), View: tmuxInstallView{State: "running", Log: "private log"}}
	tmuxInstalls.Unlock()
	defer func() { tmuxInstalls.Lock(); delete(tmuxInstalls.rows, m.ServerUUID); tmuxInstalls.Unlock() }()
	form := map[string]any{"server_id": 7, "confirm": true}
	own, err := tmuxInstallStatus(sessionRequestContext(t, form))
	require.NoError(t, err)
	require.Equal(t, "private log", own.Log)
	foreign := sessionRequestContext(t, form)
	foreign.Set(model.CtxKeyAuthorizedUser, &model.User{Common: model.Common{ID: 101}, Role: model.RoleAdmin})
	other, err := tmuxInstallStatus(foreign)
	require.NoError(t, err)
	require.Empty(t, other.Log)
	_, err = installTmux(foreign)
	require.Error(t, err)
	pat := sessionRequestContext(t, form)
	pat.Set(model.CtxKeyAPIToken, &model.APIToken{})
	_, err = tmuxInstallStatus(pat)
	require.Error(t, err)
}
