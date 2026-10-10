package controller

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"testing"
)

func telegramBotFixture(id, owner uint64) model.Notification {
	return model.Notification{Common: model.Common{ID: id, UserID: owner}, Name: "TG",
		URL: "https://api.telegram.org/bot123:fixture_token/sendMessage", RequestMethod: 2, RequestType: 1,
		RequestHeader: `{"X-Keep":"secret-header"}`, RequestBody: `{"chat_id":12345678,"text":"#NEZHA#","custom":"keep"}`,
		TelegramMenu:   &model.TelegramMenuConfig{Enabled: true, ExpiryDays: 7, LoginSuccess: true, DailyTraffic: true},
		EventTemplates: &model.NotificationEventConfig{Enabled: true}}
}
func TestTelegramBotListRedactsSecretsAndFiltersOwnership(t *testing.T) {
	defer setupTenancyTest(t)()
	empty, err := listTelegramBots(ctxAs(10, model.RoleMember))
	require.NoError(t, err)
	require.Empty(t, empty)
	n, other := telegramBotFixture(11, 10), telegramBotFixture(12, 20)
	httpOnly := model.Notification{Common: model.Common{ID: 13, UserID: 10}, URL: "https://example.org/hook", Name: "HTTP"}
	require.NoError(t, singleton.DB.Create(&n).Error)
	require.NoError(t, singleton.DB.Create(&other).Error)
	require.NoError(t, singleton.DB.Create(&httpOnly).Error)
	rows, err := listTelegramBots(ctxAs(10, model.RoleMember))
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.EqualValues(t, 11, rows[0].ID)
	raw, err := json.Marshal(rows)
	require.NoError(t, err)
	for _, secret := range []string{"fixture_token", "secret-header", "12345678", "request_body", "request_header", "api.telegram.org"} {
		require.NotContains(t, string(raw), secret)
	}
	admin, err := listTelegramBots(ctxAs(1, model.RoleAdmin))
	require.NoError(t, err)
	require.Len(t, admin, 2)
}
func TestTelegramBotSavePreservesNotificationAndAuthorizes(t *testing.T) {
	defer setupTenancyTest(t)()
	n := telegramBotFixture(11, 10)
	require.NoError(t, singleton.DB.Create(&n).Error)
	config := *n.TelegramMenu
	config.Items = map[string]bool{"online": false, "traffic": false}
	body := map[string]any{"telegram_menu": config, "url": "https://attacker.invalid", "name": "bad", "user_id": 900}
	for _, uid := range []uint64{20, 10} {
		c := ctxAsMemberWithBody(uid, body)
		c.Params = gin.Params{{Key: "id", Value: "11"}}
		if uid == 10 {
			c.Set(model.CtxKeyAPIToken, &model.APIToken{})
		}
		_, err := saveTelegramBot(c)
		require.Error(t, err)
	}
	c := ctxAsMemberWithBody(10, body)
	c.Params = gin.Params{{Key: "id", Value: "11"}}
	saved, err := saveTelegramBot(c)
	require.NoError(t, err)
	require.False(t, saved.Config.ItemEnabled("online"))
	require.True(t, saved.Config.DailyTraffic)
	var after model.Notification
	require.NoError(t, singleton.DB.First(&after, 11).Error)
	require.Equal(t, n.URL, after.URL)
	require.Equal(t, n.Name, after.Name)
	require.Equal(t, n.UserID, after.UserID)
	require.Equal(t, n.RequestBody, after.RequestBody)
	require.Equal(t, n.RequestHeader, after.RequestHeader)
	require.Equal(t, n.EventTemplates, after.EventTemplates)
	require.False(t, after.TelegramMenu.ItemEnabled("traffic"))
	require.True(t, after.TelegramMenu.LoginSuccess)
	// Subsequent ordinary notification saves omit robot configuration and retain switches.
	form := model.NotificationForm{Name: "renamed", URL: after.URL, RequestMethod: 2, RequestType: 1, SkipCheck: true}
	edit := ctxAsMemberWithBody(10, form)
	edit.Params = gin.Params{{Key: "id", Value: "11"}}
	_, err = updateNotification(edit)
	require.NoError(t, err)
	require.NoError(t, singleton.DB.First(&after, 11).Error)
	require.False(t, after.TelegramMenu.ItemEnabled("online"))
	require.True(t, after.TelegramMenu.DailyTraffic)
}
func TestTelegramBotInvalidOrMissingNotificationCannotEnable(t *testing.T) {
	defer setupTenancyTest(t)()
	n := telegramBotFixture(11, 10)
	n.RequestBody = `{"chat_id":-100123}`
	n.TelegramMenu = nil
	require.NoError(t, singleton.DB.Create(&n).Error)
	rows, err := listTelegramBots(ctxAs(10, model.RoleMember))
	require.NoError(t, err)
	require.False(t, rows[0].Eligible)
	require.NotEmpty(t, rows[0].Reason)
	for _, id := range []string{"11", "999"} {
		c := ctxAsMemberWithBody(10, map[string]any{"telegram_menu": model.TelegramMenuConfig{Enabled: true, ExpiryDays: 7}})
		c.Params = gin.Params{{Key: "id", Value: id}}
		_, err = saveTelegramBot(c)
		require.Error(t, err)
	}
	c := ctxAsMemberWithBody(10, map[string]any{"telegram_menu": model.TelegramMenuConfig{Enabled: false, ExpiryDays: 7}})
	c.Params = gin.Params{{Key: "id", Value: "11"}}
	_, err = saveTelegramBot(c)
	require.NoError(t, err)
	c = ctxAsMemberWithBody(10, map[string]any{})
	c.Params = gin.Params{{Key: "id", Value: "11"}}
	_, err = saveTelegramBot(c)
	require.Error(t, err)
}
