package controller

import (
	"encoding/json"
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

func setupInsight(t *testing.T) {
	setupServerGroupVisibilityFixture(t)
	require.NoError(t, singleton.DB.AutoMigrate(&model.ServerIPHistory{}, &networkinsight.Record{}, &networkinsight.BGPPolicy{}, &connectivity.Policy{}))
}
func TestInsightReadOnlyVisibilityPermissionAndDisabled(t *testing.T) {
	setupInsight(t)
	owner := &model.User{Common: model.Common{ID: 1}, Role: model.RoleMember}
	other := &model.User{Common: model.Common{ID: 200}, Role: model.RoleMember}
	for _, kind := range []string{"bgp", "streaming"} {
		for _, u := range []*model.User{nil, owner, other} {
			c := connectivityContext("1", u)
			got, e := readInsight(c, kind)
			require.NoError(t, e)
			require.Equal(t, u == owner, got.CanRun)
			require.Equal(t, "idle", got.State)
		}
		_, e := readInsight(connectivityContext("2", nil), kind)
		require.Error(t, e)
		_, e = startInsight(connectivityContext("1", nil), kind)
		require.EqualError(t, e, "permission denied")
		_, e = startInsight(connectivityContext("1", other), kind)
		require.EqualError(t, e, "permission denied")
		c := connectivityContext("1", owner)
		c.Request = httptest.NewRequest("POST", "/", strings.NewReader("{\"url\":\"http://localhost\"}"))
		_, e = startInsight(c, kind)
		require.ErrorContains(t, e, "不接受")
	}
	var count int64
	require.NoError(t, singleton.DB.Model(&networkinsight.Record{}).Count(&count).Error)
	require.Zero(t, count)
	require.Empty(t, insightJobs.values)
	server, _ := singleton.ServerShared.Get(1)
	server.BGPDisabled = true
	server.StreamingDisabled = true
	for _, kind := range []string{"bgp", "streaming"} {
		_, e := readInsight(connectivityContext("1", owner), kind)
		require.Error(t, e)
		_, e = startInsight(connectivityContext("1", owner), kind)
		require.Error(t, e)
	}
}
func TestInsightPersistedCacheIdentityExpiryAndHistory(t *testing.T) {
	setupInsight(t)
	server, _ := singleton.ServerShared.Get(1)
	identity, _, e := insightIdentity(server)
	require.NoError(t, e)
	at := time.Now().UnixMilli()
	snap := networkinsight.Snapshot{State: "complete", FinishedAt: at, Topologies: []networkinsight.Topology{{Family: "IPv4", Status: "ok", Prefix: "8.8.8.0/24"}}}
	raw, _ := json.Marshal(snap)
	require.NoError(t, singleton.DB.Create(&networkinsight.Record{Identity: identity, Kind: "bgp", FinishedAt: at, Payload: string(raw)}).Error)
	got, e := readInsight(connectivityContext("1", nil), "bgp")
	require.NoError(t, e)
	require.Equal(t, "complete", got.State)
	require.Len(t, got.History, 1)
	server.SetUserID(200)
	changed, _, e := insightIdentity(server)
	require.NoError(t, e)
	require.NotEqual(t, identity, changed)
	got, e = readInsight(connectivityContext("1", nil), "bgp")
	require.NoError(t, e)
	require.Equal(t, "idle", got.State)
	server.SetUserID(1)
	require.NoError(t, singleton.DB.Create(&model.ServerIPHistory{ServerUUID: server.UUID, CurrentIP: model.IP{IPv4Addr: "1.1.1.1"}}).Error)
	changed, _, e = insightIdentity(server)
	require.NoError(t, e)
	require.NotEqual(t, identity, changed)
	got, e = readInsight(connectivityContext("1", nil), "bgp")
	require.NoError(t, e)
	require.Equal(t, "idle", got.State)
	expired, e := insightLatest(identity, "bgp", at+1)
	require.NoError(t, e)
	require.Equal(t, "idle", expired.State)
}

func TestInsightPATScopeWhitelistQueryAndIndependentSwitches(t *testing.T) {
	setupInsight(t)
	admin := &model.User{Common: model.Common{ID: 1}, Role: model.RoleAdmin}
	token := &model.APIToken{}
	token.SetServerIDs([]uint64{1})
	token.SetScopes([]string{model.ScopeServerRead})
	for _, kind := range []string{"bgp", "streaming"} {
		c := connectivityContext("1", admin)
		c.Set(model.CtxKeyAPIToken, token)
		c.Set(apiTokenCtxKey, token)
		got, err := readInsight(c, kind)
		require.NoError(t, err)
		require.False(t, got.CanRun)
		_, err = startInsight(c, kind)
		require.EqualError(t, err, "permission denied")
		token.SetScopes([]string{model.ScopeServerRead, model.ScopeServiceWrite})
		got, err = readInsight(c, kind)
		require.NoError(t, err)
		require.True(t, got.CanRun)
		c.Request = httptest.NewRequest("POST", "/api/v1/server/1/"+kind+"?url=http://localhost", nil)
		_, err = startInsight(c, kind)
		require.ErrorContains(t, err, "不接受")
		blocked := connectivityContext("2", admin)
		blocked.Set(model.CtxKeyAPIToken, token)
		blocked.Set(apiTokenCtxKey, token)
		_, err = readInsight(blocked, kind)
		require.Error(t, err)
		token.SetScopes([]string{model.ScopeServerRead})
	}
	s, _ := singleton.ServerShared.Get(1)
	s.BGPDisabled = true
	_, err := readInsight(connectivityContext("1", admin), "bgp")
	require.Error(t, err)
	_, err = readInsight(connectivityContext("1", admin), "streaming")
	require.NoError(t, err)
	s.BGPDisabled = false
	s.StreamingDisabled = true
	_, err = readInsight(connectivityContext("1", admin), "bgp")
	require.NoError(t, err)
	_, err = readInsight(connectivityContext("1", admin), "streaming")
	require.Error(t, err)
}
func TestInsightCooldownRejectsDuplicateBeforeLaunching(t *testing.T) {
	setupInsight(t)
	s, _ := singleton.ServerShared.Get(1)
	require.NoError(t, singleton.DB.Create(&model.ServerIPHistory{ServerUUID: s.UUID, CurrentIP: model.IP{IPv4Addr: "8.8.8.8"}}).Error)
	identity, _, err := insightIdentity(s)
	require.NoError(t, err)
	now := time.Now().UnixMilli()
	raw, _ := json.Marshal(networkinsight.Snapshot{State: "complete", FinishedAt: now, RetryAt: now + 300000})
	require.NoError(t, singleton.DB.Create(&networkinsight.Record{Identity: identity, Kind: "bgp", FinishedAt: now, Payload: string(raw)}).Error)
	require.EqualError(t, launchInsight(s, "bgp", false), "请稍后重试")
	require.Empty(t, insightJobs.values)
	require.Empty(t, insightSlots)
}

func TestInsightPrefixIsAdminOnlyForLatestHistoryAndRunning(t *testing.T) {
	setupInsight(t)
	server, _ := singleton.ServerShared.Get(1)
	identity, _, err := insightIdentity(server)
	require.NoError(t, err)
	now := time.Now().UnixMilli()
	snap := networkinsight.Snapshot{State: "complete", FinishedAt: now, Topologies: []networkinsight.Topology{
		{Family: "IPv4", Status: "ok", Prefix: "8.8.8.0/24", Total: 10},
		{Family: "IPv6", Status: "ok", Prefix: "2606:4700::/32", Total: 12},
	}}
	raw, _ := json.Marshal(snap)
	require.NoError(t, singleton.DB.Create(&networkinsight.Record{Identity: identity, Kind: "bgp", FinishedAt: now, Payload: string(raw)}).Error)
	admin := &model.User{Common: model.Common{ID: 1}, Role: model.RoleAdmin}
	owner := &model.User{Common: model.Common{ID: 1}, Role: model.RoleMember}
	for _, running := range []bool{false, true} {
		if running {
			insightJobs.Lock()
			insightJobs.values[identity+"bgp"] = cloneInsight(snap)
			insightJobs.Unlock()
			defer func() { insightJobs.Lock(); delete(insightJobs.values, identity+"bgp"); insightJobs.Unlock() }()
		}
		for _, user := range []*model.User{nil, owner, {Common: model.Common{ID: 200}, Role: model.RoleMember}, admin} {
			got, err := readInsight(connectivityContext("1", user), "bgp")
			require.NoError(t, err)
			require.Equal(t, user == admin, got.CanViewIP)
			body, _ := json.Marshal(got)
			for _, p := range []string{"8.8.8.0/24", "2606:4700::/32"} {
				if user == admin {
					require.Contains(t, string(body), p)
				} else {
					require.NotContains(t, string(body), p)
				}
			}
			require.Equal(t, 10, got.Topologies[0].Total)
			require.Len(t, got.History, 1)
		}
	}
}
func TestInsightPoliciesHaveIndependentRetention(t *testing.T) {
	setupInsight(t)
	now := time.Now()
	for _, kind := range []string{"bgp", "streaming"} {
		require.NoError(t, singleton.DB.Create(&networkinsight.Record{Identity: kind, Kind: kind, FinishedAt: now.Add(-48 * time.Hour).UnixMilli(), Payload: "{}"}).Error)
	}
	require.NoError(t, pruneInsight("bgp", connectivity.Policy{RetentionDays: 1}, now))
	var bgp, media int64
	require.NoError(t, singleton.DB.Model(&networkinsight.Record{}).Where("kind = ?", "bgp").Count(&bgp).Error)
	require.NoError(t, singleton.DB.Model(&networkinsight.Record{}).Where("kind = ?", "streaming").Count(&media).Error)
	require.Zero(t, bgp)
	require.EqualValues(t, 1, media)
	require.NoError(t, pruneInsight("streaming", connectivity.Policy{RetentionDays: 3}, now))
	require.NoError(t, singleton.DB.Model(&networkinsight.Record{}).Where("kind = ?", "streaming").Count(&media).Error)
	require.EqualValues(t, 1, media)
}

func TestBGPFamiliesFollowLiveIPDisappearanceAndRecovery(t *testing.T) {
	setupInsight(t)
	server, _ := singleton.ServerShared.Get(1)
	row := model.ServerIPHistory{ServerUUID: server.UUID, CurrentIP: model.IP{IPv4Addr: "1.1.1.1", IPv6Addr: "2606:4700:4700::1111"}}
	require.NoError(t, singleton.DB.Create(&row).Error)
	identity, _, err := insightIdentity(server)
	require.NoError(t, err)
	now := time.Now().UnixMilli()
	raw, _ := json.Marshal(networkinsight.Snapshot{State: "complete", FinishedAt: now, Topologies: []networkinsight.Topology{{Family: "IPv6", Status: "ok", Prefix: "2606:4700::/32"}}})
	require.NoError(t, singleton.DB.Create(&networkinsight.Record{Identity: identity, Kind: "bgp", FinishedAt: now, Payload: string(raw)}).Error)
	for _, ip6 := range []string{"2606:4700:4700::1111", "", "2606:4700:4700::2222"} {
		row.CurrentIP.IPv6Addr = ip6
		require.NoError(t, singleton.DB.Save(&row).Error)
		got, err := readInsight(connectivityContext("1", nil), "bgp")
		require.NoError(t, err)
		want := []string{"IPv4"}
		if ip6 != "" {
			want = append(want, "IPv6")
		}
		require.Equal(t, want, got.AvailableFamilies)
		body, _ := json.Marshal(got)
		require.NotContains(t, string(body), "2606:4700")
		require.NotContains(t, string(body), "1.1.1.1")
		if ip6 == "" {
			require.Empty(t, got.Topologies)
			require.Empty(t, got.History)
		}
	}
	require.Equal(t, []string{"IPv6"}, bgpAvailableFamilies(model.IP{IPv6Addr: "2606:4700:4700::1111"}, networkinsight.Snapshot{}))
	require.Equal(t, []string{"IPv4"}, bgpAvailableFamilies(model.IP{}, networkinsight.Snapshot{Topologies: []networkinsight.Topology{{Family: "IPv6", Status: "no_public_ip"}}}))
}

func TestInsightAutomaticSlotDeduplicatesAfterManualRecordAndRestart(t *testing.T) {
	setupInsight(t)
	server, _ := singleton.ServerShared.Get(1)
	require.NoError(t, singleton.DB.Create(&model.ServerIPHistory{ServerUUID: server.UUID, CurrentIP: model.IP{IPv4Addr: "1.1.1.1"}}).Error)
	identity, _, err := insightIdentity(server)
	require.NoError(t, err)
	for _, kind := range []string{"bgp", "streaming"} {
		p, err := insightPolicy(kind)
		require.NoError(t, err)
		slot := connectivity.ClockSlot(time.Now(), p.IntervalHours).UnixMilli()
		saved := networkinsight.Snapshot{State: "complete", ScheduledAt: slot, StartedAt: slot + 1000, FinishedAt: slot + 2000}
		raw, err := json.Marshal(saved)
		require.NoError(t, err)
		require.NoError(t, singleton.DB.Create(&networkinsight.Record{Identity: identity, Kind: kind, ScheduledAt: slot, FinishedAt: saved.FinishedAt, Payload: string(raw)}).Error)
		saved.ScheduledAt = 0
		saved.FinishedAt += 1000
		raw, err = json.Marshal(saved)
		require.NoError(t, err)
		require.NoError(t, singleton.DB.Create(&networkinsight.Record{Identity: identity, Kind: kind, FinishedAt: saved.FinishedAt, Payload: string(raw)}).Error)
		require.ErrorIs(t, launchInsight(server, kind, true), connectivity.ErrNotReady)
		require.Empty(t, insightJobs.values)
	}
}

func TestInsightOnlyAdminBypassesCooldownWithoutBypassingCapacity(t *testing.T) {
	setupInsight(t)
	server, _ := singleton.ServerShared.Get(1)
	require.NoError(t, singleton.DB.Create(&model.ServerIPHistory{ServerUUID: server.UUID, CurrentIP: model.IP{IPv4Addr: "1.1.1.1"}}).Error)
	identity, _, err := insightIdentity(server)
	require.NoError(t, err)
	now := time.Now().UnixMilli()
	raw, _ := json.Marshal(networkinsight.Snapshot{State: "complete", FinishedAt: now, RetryAt: now + 300000})
	require.NoError(t, singleton.DB.Create(&networkinsight.Record{Identity: identity, Kind: "bgp", FinishedAt: now, Payload: string(raw)}).Error)
	oldSlots := insightSlots
	insightSlots = make(chan struct{}, 1)
	insightSlots <- struct{}{}
	defer func() { insightSlots = oldSlots }()
	owner := &model.User{Common: model.Common{ID: 1}, Role: model.RoleMember}
	admin := &model.User{Common: model.Common{ID: 10}, Role: model.RoleAdmin}
	_, err = startBGP(connectivityContext("1", owner))
	require.EqualError(t, err, "请稍后重试")
	_, err = startBGP(connectivityContext("1", admin))
	require.EqualError(t, err, "检测繁忙，请稍后重试")
	require.EqualError(t, launchInsight(server, "bgp", true, true), "请稍后重试")
	require.Empty(t, insightJobs.values)
}
