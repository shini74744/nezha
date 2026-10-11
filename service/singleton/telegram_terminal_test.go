package singleton

import (
	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"strings"
	"testing"
	"time"
)

func TestTelegramTerminalMenuIsIndependentOptInAndOneUse(t *testing.T) {
	n := telegramSetup(t)
	require.False(t, n.TelegramMenu.ItemEnabled("terminal"))
	n.TelegramMenu.Terminal = true
	n.TelegramMenu.TerminalOrigin = "https://terminal.example"
	commands := telegramCommandList(n.TelegramMenu)
	require.Len(t, commands, 6)
	require.Equal(t, "terminal", commands[5]["command"])
	now := time.Now()
	view, err := telegramTerminalView(n, now)
	require.NoError(t, err)
	filtered := telegramFilterKeyboard(view.Markup, n.TelegramMenu)
	require.Len(t, filtered.Rows, 1)
	require.Len(t, filtered.Rows[0], 1)
	url := filtered.Rows[0][0].WebApp.URL
	require.True(t, strings.HasPrefix(url, "https://terminal.example/telegram-terminal/#launch="))
	token := strings.Split(url, "#launch=")[1]
	launch, ok := GetTelegramTerminalLaunch(token, now, true)
	require.True(t, ok)
	require.Equal(t, n.ID, launch.NotificationID)
	_, ok = GetTelegramTerminalLaunch(token, now, true)
	require.False(t, ok)
	n.TelegramMenu.Terminal = false
	require.Empty(t, telegramFilterKeyboard(view.Markup, n.TelegramMenu).Rows)
	require.False(t, (*model.TelegramMenuConfig)(nil).ItemEnabled("terminal"))
}
