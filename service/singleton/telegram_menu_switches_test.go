package singleton

import (
	"context"
	"encoding/json"
	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func TestTelegramMenuSwitchesDefaultsAndDisabledRequests(t *testing.T) {
	var legacy model.TelegramMenuConfig
	require.NoError(t, json.Unmarshal([]byte(`{"enabled":true,"expiry_days":7}`), &legacy))
	require.Len(t, telegramCommandList(&legacy), 5)
	for _, command := range telegramMenuCommands {
		config := &model.TelegramMenuConfig{Enabled: true, ExpiryDays: 7, Items: map[string]bool{command.Category: false}}
		require.Len(t, telegramCommandList(config), 4)
		// No database is set up: a disabled request must return before data access.
		view, err := telegramConfiguredView(context.Background(), &model.Notification{TelegramMenu: config}, command.Category, 0, time.Now())
		require.NoError(t, err)
		require.Contains(t, view.Text, "该功能已关闭")
		for _, row := range view.Markup.Rows {
			for _, button := range row {
				kind, _, ok := telegramParseCallback(button.Data)
				require.True(t, ok)
				require.NotEqual(t, command.Category, kind)
			}
		}
	}
}
func TestTelegramTrafficSwitchIncludesHistoricalButtons(t *testing.T) {
	config := &model.TelegramMenuConfig{Enabled: true, ExpiryDays: 7, DailyTraffic: true, Items: map[string]bool{"traffic": false}}
	for _, kind := range []string{"traffic", "yesterday", "day2026-10-10"} {
		require.False(t, telegramMenuItemEnabled(config, kind))
		view, err := telegramConfiguredView(context.Background(), &model.Notification{TelegramMenu: config}, kind, 0, time.Now())
		require.NoError(t, err)
		require.Contains(t, view.Text, "该功能已关闭")
	}
	buttons := telegramKeyboard{Rows: [][]telegramButton{
		{{Text: "day", Data: "nzsm:day2026-10-10:0"}, {Text: "today", Data: "nzsm:traffic:0"}},
		{{Text: "home", Data: "nzsm:home:0"}},
	}}
	filtered := telegramFilterKeyboard(buttons, config)
	require.Len(t, filtered.Rows, 1)
	require.Equal(t, "nzsm:home:0", filtered.Rows[0][0].Data)
	require.True(t, config.DailyTraffic)
	config.Items = map[string]bool{"home": false, "online": false, "offline": false, "expiry": false, "traffic": false}
	require.Empty(t, telegramCommandList(config))
	require.NotNil(t, telegramCommandList(config))
	require.Empty(t, telegramFilterKeyboard(buttons, config).Rows)
	require.NotNil(t, telegramFilterKeyboard(buttons, config).Rows)
}
func TestTelegramMenuSwitchBindingChanges(t *testing.T) {
	n := &model.Notification{TelegramMenu: &model.TelegramMenuConfig{Enabled: true, ExpiryDays: 7}}
	old := telegramMenuBinding(n)
	n.TelegramMenu.Items = map[string]bool{"offline": false}
	require.NotEqual(t, old, telegramMenuBinding(n))
}
