package singleton

import (
	"github.com/stretchr/testify/require"
	"testing"
)

func TestTelegramMenuDirectCommandCatalog(t *testing.T) {
	require.Equal(t, []map[string]string{
		{"command": "servers", "description": "🖥 服务器概览"},
		{"command": "online", "description": "🟢 在线服务器"},
		{"command": "offline", "description": "🔴 离线服务器"},
		{"command": "expiring", "description": "⏳ 即将到期服务器"},
		{"command": "traffic", "description": "📊 今日流量统计"},
	}, telegramCommandList())
}
func TestTelegramMenuDirectCommandParsing(t *testing.T) {
	for _, tc := range []struct{ text, kind string }{
		{"/servers", "home"}, {"/start", "home"}, {"/online", "online"}, {"/offline", "offline"}, {"/expiring", "expiry"},
		{"/online@fixturebot", "online"}, {"/OFFLINE@FixtureBot", "offline"}, {"/expiring@fixturebot", "expiry"},
		{"  /servers  ", "home"}, {"/start invitation", "home"},
	} {
		t.Run(tc.text, func(t *testing.T) {
			kind, ok := telegramParseCommand(tc.text, "fixturebot")
			require.True(t, ok)
			require.Equal(t, tc.kind, kind)
		})
	}
	for _, text := range []string{"", "online", "/online_other", "/serversfake", "/online@foreignbot", "/offline@", "/expiring@fixturebot@foreign", "/exec", "/@fixturebot"} {
		t.Run("reject"+text, func(t *testing.T) { _, ok := telegramParseCommand(text, "fixturebot"); require.False(t, ok) })
	}
	_, ok := telegramParseCommand("/online@fixturebot", "")
	require.False(t, ok)
}
