package controller

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/connectivity"
	"github.com/nezhahq/nezha/service/networkinsight"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBGPAutomationPolicyPersistenceRevisionAndAdmin(t *testing.T) {
	setupServerGroupVisibilityFixture(t)
	require.NoError(t, singleton.DB.AutoMigrate(&networkinsight.BGPPolicy{}, &connectivity.Policy{}))
	oldEnabled := bgpAutoEnabled.Load()
	t.Cleanup(func() { bgpAutoEnabled.Store(oldEnabled) })
	ctx := func(method, body string) *gin.Context {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(method, "/api/v1/setting/bgp/automation", strings.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
		return c
	}
	initial, err := getBGPAutomation(ctx("GET", ""))
	require.NoError(t, err)
	require.Equal(t, networkinsight.DefaultBGPPolicy(), initial.BGPPolicy)
	next := *initial
	next.Enabled = false
	next.IntervalHours = 4
	next.RetentionDays = 3
	raw, _ := json.Marshal(next)
	saved, err := updateBGPAutomation(ctx("PUT", string(raw)))
	require.NoError(t, err)
	require.Equal(t, next.BGPPolicy, saved.BGPPolicy)
	require.NotEqual(t, initial.Revision, saved.Revision)
	require.False(t, bgpAutoEnabled.Load())
	again, err := getBGPAutomation(ctx("GET", ""))
	require.NoError(t, err)
	require.Equal(t, saved, again)
	_, err = updateBGPAutomation(ctx("PUT", string(raw)))
	require.Error(t, err)
	next = *saved
	next.IntervalHours = 0
	raw, _ = json.Marshal(next)
	_, err = updateBGPAutomation(ctx("PUT", string(raw)))
	require.Error(t, err)
	unchanged, err := getBGPAutomation(ctx("GET", ""))
	require.NoError(t, err)
	require.Equal(t, saved, unchanged)
	other, err := insightPolicy("streaming")
	require.NoError(t, err)
	require.Equal(t, connectivity.DefaultPolicy(), other)
	for _, user := range []*model.User{nil, {Role: model.RoleMember}} {
		rec := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(rec)
		c.Request = httptest.NewRequest("GET", "/", nil)
		if user != nil {
			c.Set(model.CtxKeyAuthorizedUser, user)
		}
		adminHandler(getBGPAutomation)(c)
		var denied map[string]any
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &denied))
		require.NotEqual(t, true, denied["success"])
	}
}
