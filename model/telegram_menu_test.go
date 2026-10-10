package model

import (
	"github.com/stretchr/testify/require"
	"testing"
)

func telegramMenuFixture() Notification {
	return Notification{URL: "https://api.telegram.org/bot123:fixture_token/sendMessage", RequestMethod: 2, RequestType: 1, RequestBody: `{"chat_id":12345678,"text":"#NEZHA#"}`, TelegramMenu: &TelegramMenuConfig{Enabled: true, ExpiryDays: 7}}
}
func TestTelegramMenuPrivateTargetAndConfig(t *testing.T) {
	n := telegramMenuFixture()
	require.NoError(t, n.ValidateTelegramMenu())
	target, err := n.TelegramMenuTarget()
	require.NoError(t, err)
	require.Equal(t, int64(12345678), target.ChatID)
	require.Len(t, target.BotKey, 64)
	for _, body := range []string{`{"chat_id":"-100123"}`, `{"chat_id":"@channel"}`, `{"chat_id":0}`, `{"chat_id":12.5}`, `{"chat_id":4503599627370496}`, `{"chat_id":12345678,"message_thread_id":1}`} {
		copy := n
		copy.RequestBody = body
		require.Error(t, copy.ValidateTelegramMenu(), body)
	}
	for _, url := range []string{"http://api.telegram.org/bot123:fixture_token/sendMessage", "https://evil.example/bot123:fixture_token/sendMessage", "https://api.telegram.org.evil.example/bot123:fixture_token/sendMessage", "https://user:pass@api.telegram.org/bot123:fixture_token/sendMessage", "https://api.telegram.org/botbad/sendMessage"} {
		copy := n
		copy.URL = url
		require.Error(t, copy.ValidateTelegramMenu())
	}
	n.RequestMethod = 1
	n.URL += "?chat_id=12345678"
	require.NoError(t, n.ValidateTelegramMenu())
	n.TelegramMenu.ExpiryDays = 0
	require.Error(t, n.ValidateTelegramMenu())
	n.TelegramMenu.ExpiryDays = 366
	require.Error(t, n.ValidateTelegramMenu())
	n.TelegramMenu.Enabled = false
	require.NoError(t, n.ValidateTelegramMenu())
}

func TestTelegramMenuItemDefaultsAndValidation(t *testing.T) {
	for _, config := range []*TelegramMenuConfig{nil, {}, {Items: map[string]bool{"offline": false}}} {
		require.True(t, config.ItemEnabled("home"))
		require.False(t, config.ItemEnabled("unknown"))
	}
	n := Notification{TelegramMenu: &TelegramMenuConfig{Items: map[string]bool{"unknown": true}}}
	require.Error(t, n.ValidateTelegramMenu())
}
