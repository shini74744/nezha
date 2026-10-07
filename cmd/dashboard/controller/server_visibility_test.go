package controller

import (
	"bytes"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"net/http"
	"net/http/httptest"
	"testing"
)

func visibilityContext(body string, user *model.User) *gin.Context {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/batch-visibility/server", bytes.NewBufferString(body))
	c.Request.Header.Set("Content-Type", "application/json")
	if user != nil {
		c.Set(model.CtxKeyAuthorizedUser, user)
	}
	return c
}
func TestBatchVisibilityOnlyUpdatesRequestedFlags(t *testing.T) {
	setupServerGroupVisibilityFixture(t)
	require.NoError(t, singleton.DB.Model(&model.Server{}).Where("id = 1").Updates(map[string]any{"enable_d_dns": true, "public_note": "keep-logo", "note": "keep-private"}).Error)
	singleton.ServerShared = singleton.NewServerClass()
	admin := &model.User{Common: model.Common{ID: 1}, Role: model.RoleAdmin}
	result, err := batchUpdateServerVisibility(visibilityContext(`{"ids":[1,2,1],"hide_for_display":true}`, admin))
	require.NoError(t, err)
	require.Equal(t, 2, result.Updated)
	var first, second model.Server
	require.NoError(t, singleton.DB.First(&first, 1).Error)
	require.NoError(t, singleton.DB.First(&second, 2).Error)
	require.True(t, first.HideForDisplay)
	require.False(t, first.HideForGuest)
	require.True(t, first.EnableDDNS)
	require.Equal(t, "keep-logo", first.PublicNote)
	require.Equal(t, "keep-private", first.Note)
	require.True(t, second.HideForGuest)
	require.True(t, second.HideForDisplay)
	cached, _ := singleton.ServerShared.Get(1)
	require.True(t, cached.HideForDisplay)
	result, err = batchUpdateServerVisibility(visibilityContext(`{"ids":[2],"hide_for_guest":false,"hide_for_display":false}`, admin))
	require.NoError(t, err)
	require.Equal(t, 1, result.Updated)
	require.NoError(t, singleton.DB.First(&second, 2).Error)
	require.False(t, second.HideForGuest)
	require.False(t, second.HideForDisplay)
	require.Len(t, singleton.ServerShared.GetSortedListForGuest(), 2)
	cached, _ = singleton.ServerShared.Get(1)
	require.True(t, cached.HideForDisplay)
}

func TestBatchVisibilityRejectsWholeBatch(t *testing.T) {
	for _, scenario := range []string{"guest", "foreign", "pat", "missing", "empty", "no-change", "invalid", "db-failure"} {
		t.Run(scenario, func(t *testing.T) {
			setupServerGroupVisibilityFixture(t)
			user := &model.User{Common: model.Common{ID: 1}, Role: model.RoleAdmin}
			body := `{"ids":[1,2],"hide_for_display":true}`
			switch scenario {
			case "guest":
				user = nil
			case "foreign":
				user = &model.User{Common: model.Common{ID: 1}, Role: model.RoleMember}
				require.NoError(t, singleton.DB.Model(&model.Server{}).Where("id = 2").Update("user_id", 200).Error)
				singleton.ServerShared = singleton.NewServerClass()
			case "missing":
				body = `{"ids":[1,999],"hide_for_display":true}`
			case "empty":
				body = `{"ids":[],"hide_for_display":true}`
			case "no-change":
				body = `{"ids":[1,2]}`
			case "invalid":
				body = `{"ids":[1,0],"hide_for_display":true}`
			case "db-failure":
				require.NoError(t, singleton.DB.Exec("CREATE TRIGGER reject_visibility BEFORE UPDATE ON servers WHEN OLD.id=2 BEGIN SELECT RAISE(ABORT,'fixture failure'); END").Error)
			}
			ctx := visibilityContext(body, user)
			if scenario == "pat" {
				ctx.Set(model.CtxKeyAPIToken, patAllowList{1})
			}
			_, err := batchUpdateServerVisibility(ctx)
			require.Error(t, err)
			var servers []model.Server
			require.NoError(t, singleton.DB.Find(&servers).Error)
			for i := range servers {
				s := &servers[i]
				require.False(t, s.HideForDisplay)
				running, _ := singleton.ServerShared.Get(s.ID)
				require.False(t, running.HideForDisplay)
			}
		})
	}
}
