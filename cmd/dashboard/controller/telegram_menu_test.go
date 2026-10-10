package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestTelegramMenuConfigAuthorizationAndPreservation(t *testing.T) {
	defer setupTenancyTest(t)()
	n := model.Notification{Common: model.Common{ID: 11, UserID: 10}, Name: "menu", URL: "https://api.telegram.org/bot123:fixture_token/sendMessage", RequestMethod: 2, RequestType: 1, RequestBody: `{"chat_id":12345678,"text":"#NEZHA#"}`}
	enabled := &model.TelegramMenuConfig{Enabled: true, ExpiryDays: 7}
	pat := ctxAs(10, model.RoleMember)
	pat.Set(model.CtxKeyAPIToken, &model.APIToken{})
	require.Error(t, checkTelegramMenuSave(pat, &n, enabled))
	require.Nil(t, n.TelegramMenu)
	require.NoError(t, checkTelegramMenuSave(ctxAs(10, model.RoleMember), &n, enabled))
	require.NoError(t, singleton.DB.Create(&n).Error)
	require.NoError(t, checkTelegramMenuSave(ctxAs(10, model.RoleMember), &n, nil))
	require.True(t, n.TelegramMenu.Enabled)
	require.Error(t, checkTelegramMenuSave(pat, &n, &model.TelegramMenuConfig{Enabled: false, ExpiryDays: 7}))
	duplicate := n
	duplicate.ID = 12
	require.Error(t, checkTelegramMenuSave(ctxAs(10, model.RoleMember), &duplicate, enabled))
	wrong := ctxAs(999, model.RoleMember)
	wrong.Params = gin.Params{{Key: "id", Value: "11"}}
	_, err := notificationTelegramMenuStatus(wrong)
	require.Error(t, err)
	own := ctxAs(10, model.RoleMember)
	own.Params = gin.Params{{Key: "id", Value: "11"}}
	status, err := notificationTelegramMenuStatus(own)
	require.NoError(t, err)
	require.NotEmpty(t, status.State)
}
func TestTelegramMenuValidationRunsEvenWithoutTestSend(t *testing.T) {
	defer setupTenancyTest(t)()
	form := model.NotificationForm{Name: "TG", URL: "https://api.telegram.org/bot123:fixture_token/sendMessage", RequestMethod: 2, RequestType: 1, RequestBody: `{"chat_id":-100123}`, SkipCheck: true, TelegramMenu: &model.TelegramMenuConfig{Enabled: true, ExpiryDays: 7}}
	_, err := createNotification(ctxAsMemberWithBody(10, form))
	require.Error(t, err)
	var count int64
	require.NoError(t, singleton.DB.Model(&model.Notification{}).Count(&count).Error)
	require.Zero(t, count)
}

func TestTelegramPasswordOptInCannotBeStagedUsingPAT(t *testing.T) {
	defer setupTenancyTest(t)()
	pat := ctxAs(10, model.RoleMember)
	pat.Set(model.CtxKeyAPIToken, &model.APIToken{})
	n := model.Notification{Common: model.Common{ID: 11, UserID: 10}}
	requested := &model.TelegramMenuConfig{Enabled: false, ExpiryDays: 7, LoginFailurePassword: true}
	require.Error(t, checkTelegramMenuSave(pat, &n, requested))
	require.Nil(t, n.TelegramMenu)
	n.TelegramMenu = requested
	require.Error(t, checkTelegramMenuSave(pat, &n, &model.TelegramMenuConfig{Enabled: false, ExpiryDays: 7}))
	require.True(t, n.TelegramMenu.LoginFailurePassword)
}
