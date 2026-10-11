package controller

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
)

func TestTmuxWindowActionsPersistNamesAndEnforceOwnershipAndLastWindow(t *testing.T) {
	m := sessionFixture(t)
	s, _ := singleton.ServerShared.Get(7)
	raw := "NZX_OK\nS|$1|99|MTExCg==\nW|$1|@1|0|bWFpbgo=\nNZX_END"
	old := runTmuxCommand
	defer func() { runTmuxCommand = old }()
	mutations := 0
	fail := false
	runTmuxCommand = func(_ context.Context, _ *model.Server, command string) (string, error) {
		if strings.Contains(command, "new-window") {
			mutations++
			if fail {
				return "", errors.New("network")
			}
			raw = "NZX_OK\nS|$1|99|MTExCg==\nW|$1|@1|0|bWFpbgo=\nW|$1|@2|1|c2Vjb25kCg==\nNZX_END"
			return "@2\n", nil
		}
		if strings.Contains(command, "kill-window") {
			mutations++
			raw = "NZX_OK\nS|$1|99|MTExCg==\nW|$1|@1|0|bWFpbgo=\nNZX_END"
			return "NZX_WINDOW_ENDED\n", nil
		}
		return raw, nil
	}
	list, err := listTerminalSessions(sessionRequestContext(t, terminalListForm{ServerID: 7}))
	require.NoError(t, err)
	require.Len(t, list.Tmux, 1)
	id := list.Tmux[0].ID
	form := tmuxWindowForm{ServerID: 7, RecordID: id, Name: "second"}
	foreign := sessionRequestContext(t, form)
	foreign.Set(model.CtxKeyAuthorizedUser, &model.User{Common: model.Common{ID: 101}, Role: model.RoleAdmin})
	_, err = createTmuxWindow(foreign)
	require.Error(t, err)
	require.Zero(t, mutations)
	pat := sessionRequestContext(t, form)
	pat.Set(model.CtxKeyAPIToken, &model.APIToken{})
	_, err = createTmuxWindow(pat)
	require.Error(t, err)
	require.Zero(t, mutations)
	s.UUID = "reused-server"
	_, err = createTmuxWindow(sessionRequestContext(t, form))
	require.Error(t, err)
	require.Zero(t, mutations)
	s.UUID = m.ServerUUID
	result, err := createTmuxWindow(sessionRequestContext(t, form))
	require.NoError(t, err)
	require.False(t, result.SessionClosed)
	require.Len(t, result.Windows, 2)
	var row model.TerminalSession
	require.NoError(t, singleton.DB.First(&row, id).Error)
	require.Contains(t, row.Windows, "second")
	var events []model.TerminalSessionEvent
	require.NoError(t, singleton.DB.Where("session_id = ? AND action LIKE ?", id, "window_%").Order("id").Find(&events).Error)
	require.Len(t, events, 2)
	require.Equal(t, "second", events[0].WindowName)
	require.Equal(t, "window_create_completed", events[1].Action)
	form.Window = "@2"
	_, err = endTmuxWindow(sessionRequestContext(t, form))
	require.Error(t, err)
	require.Equal(t, 1, mutations)
	form.Confirm = true
	form.Window = "@9"
	_, err = endTmuxWindow(sessionRequestContext(t, form))
	require.Error(t, err)
	require.Equal(t, 1, mutations)
	form.Window = "@2"
	result, err = endTmuxWindow(sessionRequestContext(t, form))
	require.NoError(t, err)
	require.Len(t, result.Windows, 1)
	require.NoError(t, singleton.DB.First(&row, id).Error)
	require.NotContains(t, row.Windows, "second")
	form.Window = "@1"
	_, err = endTmuxWindow(sessionRequestContext(t, form))
	require.ErrorContains(t, err, "只剩一个窗口")
	require.Equal(t, 2, mutations)
	fail = true
	_, err = createTmuxWindow(sessionRequestContext(t, form))
	require.Error(t, err)
	require.NoError(t, singleton.DB.First(&row, id).Error)
	require.Equal(t, "available", row.Status)
	require.NotContains(t, row.Windows, "second")
}
