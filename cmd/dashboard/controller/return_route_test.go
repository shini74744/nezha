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
	"time"
)

func TestReturnRouteSettingsPolicyPersistenceRevisionAndAdmin(t *testing.T) {
	setupServerGroupVisibilityFixture(t)
	require.NoError(t, singleton.DB.AutoMigrate(&networkinsight.ReturnPolicy{}, &connectivity.Policy{}))
	oldEnabled := returnRouteAutoEnabled.Load()
	t.Cleanup(func() { returnRouteAutoEnabled.Store(oldEnabled) })
	ctx := func(method, body string) *gin.Context {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(method, "/api/v1/setting/return-route", strings.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
		return c
	}
	initial, err := getReturnRouteSettings(ctx("GET", ""))
	require.NoError(t, err)
	require.Equal(t, networkinsight.DefaultReturnPolicy(), initial.ReturnPolicy)
	next := *initial
	next.Enabled = true
	next.IntervalHours = 4
	next.RetentionDays = 3
	raw, _ := json.Marshal(next)
	saved, err := updateReturnRouteSettings(ctx("PUT", string(raw)))
	require.NoError(t, err)
	require.Equal(t, next.ReturnPolicy, saved.ReturnPolicy)
	require.NotEqual(t, initial.Revision, saved.Revision)
	require.True(t, returnRouteAutoEnabled.Load())
	again, err := getReturnRouteSettings(ctx("GET", ""))
	require.NoError(t, err)
	require.Equal(t, saved, again)
	_, err = updateReturnRouteSettings(ctx("PUT", string(raw)))
	require.Error(t, err)
	next = *saved
	next.IntervalHours = 0
	raw, _ = json.Marshal(next)
	_, err = updateReturnRouteSettings(ctx("PUT", string(raw)))
	require.Error(t, err)
	unchanged, err := getReturnRouteSettings(ctx("GET", ""))
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
		adminHandler(getReturnRouteSettings)(c)
		var denied map[string]any
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &denied))
		require.NotEqual(t, true, denied["success"])
	}
}
func TestReturnRouteReadPermissionsRedactionHistoryAndSwitch(t *testing.T) {
	setupInsight(t)
	require.NoError(t, singleton.DB.AutoMigrate(&networkinsight.ReturnPolicy{}))
	owner := &model.User{Common: model.Common{ID: 1}, Role: model.RoleMember}
	admin := &model.User{Common: model.Common{ID: 9}, Role: model.RoleAdmin}
	server, _ := singleton.ServerShared.Get(1)
	key, _, err := insightIdentity(server)
	require.NoError(t, err)
	at := time.Now().UnixMilli()
	snap := networkinsight.Snapshot{State: "complete", FinishedAt: at, Routes: []networkinsight.ReturnResult{{ID: "sh-ct", Target: "101.226.101.195", Family: "IPv4", Status: "partial", Route: []string{"电信 CN2"}, Hops: []networkinsight.ReturnHop{{TTL: 1, IP: "59.43.1.1", ASN: "4809", Samples: 3}}}}}
	raw, _ := json.Marshal(snap)
	require.NoError(t, singleton.DB.Create(&networkinsight.Record{Identity: key, Kind: "return-route", FinishedAt: at, Payload: string(raw)}).Error)
	for _, viewer := range []*model.User{nil, owner, admin} {
		got, err := getReturnRoute(connectivityContext("1", viewer))
		require.NoError(t, err)
		require.Len(t, got.Routes, 1)
		require.Len(t, got.History, 1)
		require.NotEmpty(t, got.Routes[0].ComparisonKey)
		require.Equal(t, got.Routes[0].ComparisonKey, got.History[0].Routes[0].ComparisonKey)
		require.Equal(t, viewer != nil, got.CanRun)
		if viewer == admin {
			require.NotEmpty(t, got.Routes[0].Hops[0].IP)
		} else {
			require.Empty(t, got.Routes[0].Hops[0].IP)
			require.Empty(t, got.Routes[0].Target)
			require.Empty(t, got.History[0].Routes[0].Target)
		}
		require.Equal(t, "4809", got.Routes[0].Hops[0].ASN)
	}
	var stored networkinsight.Record
	require.NoError(t, singleton.DB.Where("identity = ? AND kind = ?", key, "return-route").First(&stored).Error)
	require.Equal(t, string(raw), stored.Payload, "comparison does not rewrite historical data")
	_, err = startReturnRoute(connectivityContext("1", nil))
	require.EqualError(t, err, "permission denied")
	ctx := connectivityContext("1", owner)
	ctx.Request = httptest.NewRequest("POST", "/", strings.NewReader("{\"ip\":\"127.0.0.1\"}"))
	_, err = startReturnRoute(ctx)
	require.ErrorContains(t, err, "不接受")
	server.BGPDisabled = true
	server.StreamingDisabled = true
	_, err = getReturnRoute(connectivityContext("1", nil))
	require.NoError(t, err)
	server.ReturnRouteDisabled = true
	_, err = getReturnRoute(connectivityContext("1", admin))
	require.Error(t, err)
	require.NoError(t, pruneInsight("return-route", connectivity.Policy{RetentionDays: 1}, time.Now().Add(48*time.Hour)))
	var n int64
	require.NoError(t, singleton.DB.Model(&networkinsight.Record{}).Where("kind = ?", "return-route").Count(&n).Error)
	require.Zero(t, n)
}

func TestReturnRoutePolicyChangesInvalidateQueuedProbes(t *testing.T) {
	setupInsight(t)
	p, err := networkinsight.ReadReturnPolicy(singleton.DB)
	require.NoError(t, err)
	require.True(t, returnPolicyCurrent(singleton.DB, p))
	scheduleOnly := p
	scheduleOnly.Enabled = !p.Enabled
	scheduleOnly.IntervalHours = 5
	scheduleOnly.RetentionDays = 3
	require.NoError(t, singleton.DB.Save(&scheduleOnly).Error)
	require.True(t, returnPolicyCurrent(singleton.DB, p))
	changed := networkinsight.DefaultReturnPolicy()
	changed.Targets[0].IPv4 = "1.1.1.1"
	require.NoError(t, singleton.DB.Save(&changed).Error)
	require.False(t, returnPolicyCurrent(singleton.DB, p))
	require.True(t, returnPolicyCurrent(singleton.DB, changed))
}
