package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNotificationEditorOwnershipAndListRedaction(t *testing.T) {
	defer setupTenancyTest(t)()
	n := model.Notification{Common: model.Common{UserID: 10}, Name: "TG", URL: "https://api.telegram.org/bot123:fake/sendMessage",
		RequestBody: "{\"text\":\"#NEZHA#\",\"chat_id\":123}", RequestHeader: "{\"X-Key\":\"fixture\"}"}
	require.NoError(t, singleton.DB.Create(&n).Error)
	singleton.NotificationShared.Update(&n)
	for _, tc := range []struct {
		uid     uint64
		role    model.Role
		allowed bool
	}{
		{10, model.RoleMember, true}, {999, model.RoleMember, false}, {1, model.RoleAdmin, true},
	} {
		c := ctxAs(tc.uid, tc.role)
		c.Params = gin.Params{{Key: "id", Value: itoa(n.ID)}}
		got, err := notificationEditor(c)
		if tc.allowed {
			require.NoError(t, err)
			require.Equal(t, n.URL, got.URL)
			require.Equal(t, n.RequestBody, got.RequestBody)
		} else {
			require.Error(t, err)
			require.Nil(t, got)
		}
		require.Equal(t, "no-store", c.Writer.Header().Get("Cache-Control"))
	}
	c := ctxAs(10, model.RoleMember)
	list, err := listNotification(c)
	require.NoError(t, err)
	require.Len(t, list, 1)
	require.Empty(t, list[0].URL)
	require.Empty(t, list[0].RequestHeader)
	require.Empty(t, list[0].RequestBody)
	require.Equal(t, "https://api.telegram.org/bot123:fake/sendMessage", n.URL)
	var after model.Notification
	require.NoError(t, singleton.DB.First(&after, n.ID).Error)
	require.Equal(t, n.RequestBody, after.RequestBody)
}

func TestNotificationEditorRejectsInvalidOrMissingID(t *testing.T) {
	defer setupTenancyTest(t)()
	for _, id := range []string{"bad", "999"} {
		c := ctxAs(10, model.RoleMember)
		c.Params = gin.Params{{Key: "id", Value: id}}
		got, err := notificationEditor(c)
		require.Error(t, err)
		require.Nil(t, got)
	}
}

func TestNotificationEditorRequiresWriteScope(t *testing.T) {
	cleanup, uid := setupMCPTest(t)
	defer cleanup()
	_, readToken := mkToken(t, uid, []string{model.ScopeNotificationRead}, nil)
	writeToken := readToken + "_write"
	write := model.APIToken{UserID: uid, Name: "editor-write", TokenHash: model.HashAPIToken(writeToken)}
	write.SetScopes([]string{model.ScopeNotificationWrite})
	require.NoError(t, singleton.DB.Create(&write).Error)
	r := gin.New()
	r.GET("/notification/1/editor", apiTokenAuthMiddleware(), restScopeMiddleware(model.ScopeNotificationWrite),
		func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) })
	ts := httptest.NewServer(r)
	defer ts.Close()
	for _, tc := range []struct {
		token  string
		status int
	}{{readToken, http.StatusForbidden}, {writeToken, http.StatusOK}} {
		response := doReq(t, ts, "GET", "/notification/1/editor", tc.token)
		require.Equal(t, tc.status, response.StatusCode)
		response.Body.Close()
	}
}
