package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"net/http/httptest"
	"testing"
)

func TestServerExpirySettingsValidationAndAdminGuard(t *testing.T) {
	defer setupTenancyTest(t)()
	require.NoError(t, singleton.DB.AutoMigrate(&model.ServerExpiryConfig{}, &model.ServerExpiryDelivery{}, &model.Server{}))
	page, err := listServerExpiry(ctxAs(1, model.RoleAdmin))
	require.NoError(t, err)
	require.False(t, page.Config.Enabled)
	require.Equal(t, []int{7, 3, 1, 0}, page.Config.Days)
	f := model.DefaultServerExpiryConfig()
	f.Enabled = true
	_, err = saveServerExpiry(ctxAsMemberWithBody(1, f))
	require.Error(t, err)
	f.NotificationGroupID = 999999
	_, err = saveServerExpiry(ctxAsMemberWithBody(1, f))
	require.Error(t, err)
	f.Enabled = false
	f.NotificationGroupID = 0
	f.Days = []int{0, 2, 10}
	_, err = saveServerExpiry(ctxAsMemberWithBody(1, f))
	require.NoError(t, err)
	got, err := singleton.GetServerExpiryConfig()
	require.NoError(t, err)
	require.Equal(t, []int{10, 2, 0}, got.Days)
	f.Days = []int{2, 2}
	_, err = saveServerExpiry(ctxAsMemberWithBody(1, f))
	require.Error(t, err)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set(model.CtxKeyAuthorizedUser, &model.User{Role: model.RoleMember})
	invoked := false
	adminHandler(func(*gin.Context) (any, error) { invoked = true; return nil, nil })(c)
	require.False(t, invoked)
	require.Contains(t, w.Body.String(), "permission denied")
}
