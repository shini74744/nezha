package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestNotificationModulesSaveReadPreserveAndDisable(t *testing.T) {
	defer setupTenancyTest(t)()
	f := model.NotificationForm{Name: "TG", URL: "https://api.telegram.org/bot123:fake/sendMessage",
		RequestMethod: 2, RequestType: 1, RequestBody: `{"chat_id":-1,"text":"#NEZHA#"}`, SkipCheck: true,
		EventTemplates: &model.NotificationEventConfig{Enabled: true, Modules: map[string]model.NotificationEventModule{
			"online": {Mode: "fields", Title: "上线啦", Fields: []string{"time", "server"}},
		}}}
	id, err := createNotification(ctxAsMemberWithBody(10, f))
	require.NoError(t, err)
	read := func() *model.Notification {
		c := ctxAs(10, model.RoleMember)
		c.Params = gin.Params{{Key: "id", Value: itoa(id)}}
		n, err := notificationEditor(c)
		require.NoError(t, err)
		return n
	}
	require.Equal(t, f.EventTemplates, read().EventTemplates)
	// Old API clients omit event_templates: preserve current settings.
	f.EventTemplates = nil
	f.Name = "renamed"
	c := ctxAsMemberWithBody(10, f)
	c.Params = gin.Params{{Key: "id", Value: itoa(id)}}
	_, err = updateNotification(c)
	require.NoError(t, err)
	require.True(t, read().EventTemplates.Enabled)
	require.Equal(t, "上线啦", read().EventTemplates.Modules["online"].Title)
	// Explicitly disabling keeps user customization, but returns to legacy rendering.
	f.EventTemplates = read().EventTemplates
	f.EventTemplates.Enabled = false
	c = ctxAsMemberWithBody(10, f)
	c.Params = gin.Params{{Key: "id", Value: itoa(id)}}
	_, err = updateNotification(c)
	require.NoError(t, err)
	require.False(t, read().EventTemplates.Enabled)
	// Invalid input is rejected before saving or sending.
	f.EventTemplates.Modules["bad"] = model.NotificationEventModule{Mode: "fields"}
	c = ctxAsMemberWithBody(10, f)
	c.Params = gin.Params{{Key: "id", Value: itoa(id)}}
	_, err = updateNotification(c)
	require.Error(t, err)
	require.NotContains(t, read().EventTemplates.Modules, "bad")
	var persisted model.Notification
	require.NoError(t, singleton.DB.First(&persisted, id).Error)
	require.Equal(t, "上线啦", persisted.EventTemplates.Modules["online"].Title)
}
