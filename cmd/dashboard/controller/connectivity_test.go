package controller

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/connectivity"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
)

func connectivityContext(id string, user *model.User) *gin.Context {
	c := newServerGroupCtx(user)
	c.Params = gin.Params{{Key: "id", Value: id}}
	return c
}
func TestConnectivityViewerPermissionsAndNoGETSideEffects(t *testing.T) {
	setupServerGroupVisibilityFixture(t)
	old := connectivityManager
	connectivityManager = connectivity.NewManager()
	t.Cleanup(func() { connectivityManager = old })
	admin := &model.User{Common: model.Common{ID: 10}, Role: model.RoleAdmin}
	owner := &model.User{Common: model.Common{ID: 1}, Role: model.RoleMember}
	other := &model.User{Common: model.Common{ID: 200}, Role: model.RoleMember}
	for _, tt := range []struct {
		user   *model.User
		canRun bool
	}{{nil, false}, {admin, true}, {owner, true}, {other, false}} {
		got, err := getConnectivity(connectivityContext("1", tt.user))
		require.NoError(t, err)
		require.Equal(t, tt.canRun, got.CanRun)
		require.Equal(t, "idle", got.State)
		require.False(t, got.Online)
	}
	_, err := getConnectivity(connectivityContext("2", nil))
	require.Error(t, err)
	_, err = getConnectivity(connectivityContext("999", admin))
	require.Error(t, err)
	_, err = getConnectivity(connectivityContext("bad", admin))
	require.Error(t, err)
	_, err = startConnectivity(connectivityContext("1", nil))
	require.EqualError(t, err, "permission denied")
	_, err = startConnectivity(connectivityContext("1", other))
	require.EqualError(t, err, "permission denied")
	_, err = startConnectivity(connectivityContext("1", owner))
	require.EqualError(t, err, "connectivity_offline")
}
func TestConnectivityPATScopeWhitelistAndInput(t *testing.T) {
	setupServerGroupVisibilityFixture(t)
	admin := &model.User{Common: model.Common{ID: 1}, Role: model.RoleAdmin}
	token := &model.APIToken{}
	token.SetServerIDs([]uint64{1})
	token.SetScopes([]string{model.ScopeServerRead})
	c := connectivityContext("1", admin)
	c.Set(model.CtxKeyAPIToken, token)
	c.Set(apiTokenCtxKey, token)
	got, err := getConnectivity(c)
	require.NoError(t, err)
	require.False(t, got.CanRun)
	_, err = startConnectivity(c)
	require.EqualError(t, err, "permission denied")
	token.SetScopes([]string{model.ScopeServerRead, model.ScopeServiceWrite})
	got, err = getConnectivity(c)
	require.NoError(t, err)
	require.True(t, got.CanRun)
	c.Params = gin.Params{{Key: "id", Value: "2"}}
	_, err = getConnectivity(c)
	require.Error(t, err)
	c = connectivityContext("1", admin)
	c.Request = httptest.NewRequest("POST", "/api/v1/server/1/connectivity", strings.NewReader("{\"url\":\"http://127.0.0.1\"}"))
	_, err = startConnectivity(c)
	require.EqualError(t, err, "connectivity accepts no target or request body")
	c.Request = httptest.NewRequest("POST", "/api/v1/server/1/connectivity?url=x", nil)
	_, err = startConnectivity(c)
	require.Error(t, err)
}
func TestConnectivityCacheNotSharedAcrossTransferOrReusedID(t *testing.T) {
	setupServerGroupVisibilityFixture(t)
	old := connectivityManager
	connectivityManager = connectivity.NewManager()
	t.Cleanup(func() { connectivityManager = old })
	server, _ := singleton.ServerShared.Get(1)
	key := connectivityKey(server)
	_, err := connectivityManager.Start(key, func(context.Context, connectivity.Target) connectivity.Sample {
		return connectivity.Sample{Status: "ok"}
	})
	require.NoError(t, err)
	require.Eventually(t, func() bool { return connectivityManager.Get(key).State == "complete" }, time.Second, time.Millisecond)
	got, err := getConnectivity(connectivityContext("1", nil))
	require.NoError(t, err)
	require.Equal(t, "complete", got.State)
	require.False(t, got.Online)
	server.SetUserID(200)
	got, err = getConnectivity(connectivityContext("1", nil))
	require.NoError(t, err)
	require.Equal(t, "idle", got.State)
	server.SetUserID(1)
	server.UUID = "replacement"
	got, err = getConnectivity(connectivityContext("1", nil))
	require.NoError(t, err)
	require.Equal(t, "idle", got.State)
}

func TestConnectivityDisabledDeniesAllViewersAndManualProbes(t *testing.T) {
	setupServerGroupVisibilityFixture(t)
	server, _ := singleton.ServerShared.Get(1)
	server.ConnectivityDisabled = true
	for _, user := range []*model.User{nil, {Common: model.Common{ID: 1}, Role: model.RoleMember}, {Common: model.Common{ID: 10}, Role: model.RoleAdmin}} {
		_, err := getConnectivity(connectivityContext("1", user))
		require.Error(t, err)
		_, err = startConnectivity(connectivityContext("1", user))
		require.Error(t, err)
	}
	server.ConnectivityDisabled = false
	_, err := getConnectivity(connectivityContext("1", nil))
	require.NoError(t, err)
}
