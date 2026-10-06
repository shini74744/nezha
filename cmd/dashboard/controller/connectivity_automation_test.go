package controller

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/connectivity"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestConnectivityAutomationPolicyPersistenceRevisionAndAdmin(t *testing.T) {
	setupServerGroupVisibilityFixture(t)
	oldManager := connectivityManager
	connectivityManager = connectivity.NewManager()
	t.Cleanup(func() { connectivityManager = oldManager })
	require.NoError(t, singleton.DB.AutoMigrate(&connectivity.Policy{}, &connectivity.Record{}))
	oldEnabled := connectivityAutoEnabled.Load()
	t.Cleanup(func() { connectivityAutoEnabled.Store(oldEnabled) })
	ctx := func(method, body string) *gin.Context {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(method, "/api/v1/setting/connectivity/automation", strings.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
		return c
	}
	initial, err := getConnectivityAutomation(ctx("GET", ""))
	require.NoError(t, err)
	require.Equal(t, connectivity.DefaultPolicy(), initial.Policy)
	next := *initial
	next.Enabled = false
	next.IntervalHours = 4
	next.RetentionDays = 3
	raw, _ := json.Marshal(next)
	saved, err := updateConnectivityAutomation(ctx("PUT", string(raw)))
	require.NoError(t, err)
	require.Equal(t, next.Policy, saved.Policy)
	require.NotEqual(t, initial.Revision, saved.Revision)
	require.False(t, connectivityAutoEnabled.Load())
	again, err := getConnectivityAutomation(ctx("GET", ""))
	require.NoError(t, err)
	require.Equal(t, saved, again)
	_, err = updateConnectivityAutomation(ctx("PUT", string(raw)))
	require.Error(t, err)
	next = *saved
	next.IntervalHours = 0
	raw, _ = json.Marshal(next)
	_, err = updateConnectivityAutomation(ctx("PUT", string(raw)))
	require.Error(t, err)
	unchanged, err := getConnectivityAutomation(ctx("GET", ""))
	require.NoError(t, err)
	require.Equal(t, saved, unchanged)
	for _, user := range []*model.User{nil, {Role: model.RoleMember}} {
		rec := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(rec)
		c.Request = httptest.NewRequest("GET", "/", nil)
		if user != nil {
			c.Set(model.CtxKeyAuthorizedUser, user)
		}
		adminHandler(getConnectivityAutomation)(c)
		var denied map[string]any
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &denied))
		require.NotEqual(t, true, denied["success"])
	}
}
