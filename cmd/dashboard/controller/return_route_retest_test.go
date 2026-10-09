package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/networkinsight"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestReturnRetestSelectionAndPreservedTimes(t *testing.T) {
	p := networkinsight.DefaultReturnPolicy()
	routes := networkinsight.EmptyReturnRoutes(p, []string{"IPv4"})
	for i := range routes {
		routes[i].Status = "reached"
	}
	stamp := time.Now().Add(-time.Hour).UnixMilli()
	latest := networkinsight.Snapshot{State: "complete", FinishedAt: stamp, Routes: routes}
	selection := &networkinsight.ReturnSelection{ID: routes[0].ID, Family: "IPv4"}
	require.True(t, returnSelectionAllowed(p, []string{"IPv4"}, *selection))
	for _, invalid := range []networkinsight.ReturnSelection{{ID: "127.0.0.1", Family: "IPv4"}, {ID: selection.ID, Family: "IPv6"}, {ID: selection.ID, Family: "ipv4"}, {ID: ";rm", Family: "IPv4"}} {
		require.False(t, returnSelectionAllowed(p, []string{"IPv4"}, invalid))
	}
	next := prepareReturnRetest(latest, p, []string{"IPv4"}, selection)
	require.Len(t, next, len(routes))
	require.Equal(t, "pending", next[0].Status)
	require.Zero(t, next[0].TestedAt)
	for _, r := range next[1:] {
		require.Equal(t, "reached", r.Status)
		require.EqualValues(t, stamp, r.TestedAt)
	}
	require.Zero(t, latest.Routes[1].TestedAt)
	latest.Routes[1].TestedAt = stamp - 500
	require.EqualValues(t, stamp-500, prepareReturnRetest(latest, p, []string{"IPv4"}, selection)[1].TestedAt)
	latest.Routes[1].TestedAt = time.Now().Add(-48 * time.Hour).UnixMilli()
	require.Len(t, prepareReturnRetest(latest, p, []string{"IPv4"}, selection), len(routes)-1)
	p.Targets[1].IPv4 = "1.1.1.1"
	require.Len(t, prepareReturnRetest(latest, p, []string{"IPv4"}, selection), len(routes)-1)
	p.Protocol = "icmp"
	require.Len(t, prepareReturnRetest(latest, p, []string{"IPv4"}, selection), 1)
	require.Len(t, prepareReturnRetest(networkinsight.Snapshot{}, p, []string{"IPv4"}, selection), 1)
	for _, r := range prepareReturnRetest(latest, p, []string{"IPv4"}, nil) {
		require.Equal(t, "pending", r.Status)
		require.Zero(t, r.TestedAt)
	}
}
func TestReturnRetestConflictSharesOnlyCoveringJob(t *testing.T) {
	setupInsight(t)
	s, _ := singleton.ServerShared.Get(1)
	require.NoError(t, singleton.DB.Create(&model.ServerIPHistory{ServerUUID: s.UUID, CurrentIP: model.IP{IPv4Addr: "8.8.8.8"}}).Error)
	identity, _, err := insightIdentity(s)
	require.NoError(t, err)
	key := identity + "return-route"
	selection := &networkinsight.ReturnSelection{ID: "bj-ct", Family: "IPv4"}
	old := returnRoutes
	returnRoutes = newReturnRouteQueue(1)
	ticket, err := returnRoutes.reserve(s.ID, key, false, networkinsight.ReturnPolicyFingerprint(networkinsight.DefaultReturnPolicy()))
	require.NoError(t, err)
	defer func() {
		insightJobs.Lock()
		delete(insightJobs.values, key)
		ticket.done()
		insightJobs.Unlock()
		returnRoutes = old
	}()
	for _, active := range []*networkinsight.ReturnSelection{nil, selection} {
		insightJobs.Lock()
		insightJobs.values[key] = networkinsight.Snapshot{State: "running", Retest: active}
		insightJobs.Unlock()
		for i := 0; i < 20; i++ {
			require.NoError(t, launchInsightSelected(s, "return-route", false, selection, true))
		}
		require.True(t, ticket.isManual())
		require.Len(t, returnRoutes.tickets, 1)
	}
	require.ErrorContains(t, launchInsight(s, "return-route", false, true), "另一项")
	require.ErrorContains(t, launchInsightSelected(s, "return-route", false, &networkinsight.ReturnSelection{ID: "sh-ct", Family: "IPv4"}, true), "另一项")
	require.Error(t, launchInsightSelected(s, "return-route", false, &networkinsight.ReturnSelection{ID: "bad", Family: "IPv4"}, true))
	require.Error(t, launchInsightSelected(s, "return-route", true, selection, true))
	changed := networkinsight.DefaultReturnPolicy()
	changed.Targets[0].IPv4 = "1.1.1.1"
	require.NoError(t, singleton.DB.Save(&changed).Error)
	require.ErrorContains(t, launchInsightSelected(s, "return-route", false, selection, true), "配置已变化")
}
func TestReturnRetestEndpointPermissionBodyQueryAndOffline(t *testing.T) {
	setupInsight(t)
	owner := &model.User{Common: model.Common{ID: 1}, Role: model.RoleMember}
	for _, user := range []*model.User{nil, {Common: model.Common{ID: 200}, Role: model.RoleMember}} {
		_, err := startReturnRouteTarget(connectivityContext("1", user))
		require.EqualError(t, err, "permission denied")
	}
	for _, tc := range []struct{ url, body string }{{"/?target=1.1.1.1", ""}, {"/", "{}"}} {
		c := connectivityContext("1", owner)
		c.Request = httptest.NewRequest("POST", tc.url, strings.NewReader(tc.body))
		_, err := startReturnRouteTarget(c)
		require.ErrorContains(t, err, "不接受")
	}
	c := connectivityContext("1", owner)
	c.Params = append(c.Params, gin.Param{Key: "target", Value: "bj-ct"}, gin.Param{Key: "family", Value: "IPv4"})
	_, err := startReturnRouteTarget(c)
	require.ErrorContains(t, err, "离线")
}
func TestReturnRetestQueuesOneTargetAndCancelsOnPolicyChange(t *testing.T) {
	setupInsight(t)
	db, err := singleton.DB.DB()
	require.NoError(t, err)
	db.SetMaxOpenConns(1)
	s, _ := singleton.ServerShared.Get(1)
	require.NoError(t, singleton.DB.Create(&model.ServerIPHistory{ServerUUID: s.UUID, CurrentIP: model.IP{IPv4Addr: "8.8.8.8"}}).Error)
	old := returnRoutes
	returnRoutes = newReturnRouteQueue(1)
	blocker, err := returnRoutes.reserve(999, "blocked", true)
	require.NoError(t, err)
	defer func() { blocker.done(); returnRoutes = old }()
	selection := &networkinsight.ReturnSelection{ID: "bj-ct", Family: "IPv4"}
	require.NoError(t, launchInsightSelected(s, "return-route", false, selection, true))
	got, err := readInsight(connectivityContext("1", &model.User{Common: model.Common{ID: 10}, Role: model.RoleAdmin}), "return-route")
	require.NoError(t, err)
	require.Equal(t, "queued", got.State)
	require.Equal(t, selection, got.Retest)
	require.Len(t, got.Routes, 1)
	require.Zero(t, got.ScheduledAt)
	p := networkinsight.DefaultReturnPolicy()
	p.Targets[0].Enabled = false
	require.NoError(t, singleton.DB.Save(&p).Error)
	blocker.done()
	require.Eventually(t, func() bool { insightJobs.Lock(); defer insightJobs.Unlock(); return len(insightJobs.values) == 0 }, time.Second, 5*time.Millisecond)
	var n int64
	require.NoError(t, singleton.DB.Model(&networkinsight.Record{}).Count(&n).Error)
	require.Zero(t, n)
}
