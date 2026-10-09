package controller

import (
	"context"
	"encoding/json"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/connectivity"
	"github.com/nezhahq/nezha/service/networkinsight"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"sync/atomic"
	"testing"
	"time"
)

func TestBGPRetryBackoffAndTerminalStatuses(t *testing.T) {
	slot := int64(1000000)
	s := networkinsight.Snapshot{State: "complete", ScheduledAt: slot, FinishedAt: slot + 1000, Topologies: []networkinsight.Topology{{Family: "IPv4", Status: "unavailable"}, {Family: "IPv6", Status: "ok"}}}
	raw, _ := json.Marshal(s)
	row := networkinsight.Record{ScheduledAt: slot, Payload: string(raw)}
	require.False(t, bgpRetryReady(row, slot, s.FinishedAt+299999))
	require.True(t, bgpRetryReady(row, slot, s.FinishedAt+300000), "legacy failed snapshots must retry after restart")
	require.False(t, bgpRetryReady(row, slot+3600000, s.FinishedAt+300000))
	require.Equal(t, []time.Duration{5 * time.Minute, 15 * time.Minute, 30 * time.Minute, time.Hour, time.Hour}, []time.Duration{bgpRetryDelay(1), bgpRetryDelay(2), bgpRetryDelay(3), bgpRetryDelay(4), bgpRetryDelay(100)})
	for _, status := range []string{"ok", "no_routes", "no_public_ip"} {
		s.Topologies[0].Status = status
		require.Zero(t, bgpNextRetry(s), "definitive/no-IP results must not trigger retries")
	}
	s.Topologies[0].Status = "unavailable"
	s.ScheduledAt = 0
	require.Zero(t, bgpNextRetry(s), "manual results are not auto scheduled")
	row.Payload = "broken"
	require.False(t, bgpRetryReady(row, slot, slot+9999999))
}
func TestBGPRetryRetainsOnlySameSlotSuccessfulFamilyAndOriginalTimestamp(t *testing.T) {
	previous := networkinsight.Snapshot{FinishedAt: 123, Topologies: []networkinsight.Topology{{Family: "IPv4", Status: "ok", Total: 123}, {Family: "IPv6", Status: "unavailable"}}}
	got, ok := bgpRetainedTopology(&previous, "IPv4")
	require.True(t, ok)
	require.EqualValues(t, 123, got.TestedAt)
	require.Equal(t, 123, got.Total)
	require.Zero(t, previous.Topologies[0].TestedAt, "do not mutate stored result")
	_, ok = bgpRetainedTopology(&previous, "IPv6")
	require.False(t, ok)
	_, ok = bgpRetainedTopology(nil, "IPv4")
	require.False(t, ok, "new slot must query every family")
}
func TestBGPHistoryCoalescesRetriesWithoutDeletingAttempts(t *testing.T) {
	setupInsight(t)
	server, _ := singleton.ServerShared.Get(1)
	identity, _, err := insightIdentity(server)
	require.NoError(t, err)
	now := time.Now().UnixMilli()
	slot := insightClockSlot("bgp", time.Now(), 6).UnixMilli()
	for i := 0; i < 4; i++ {
		scheduled := slot
		if i == 0 {
			scheduled -= 6 * 3600000
		}
		if i == 3 {
			scheduled = 0
		}
		s := networkinsight.Snapshot{State: "complete", ScheduledAt: scheduled, FinishedAt: now + int64(i), Topologies: []networkinsight.Topology{{Family: "IPv4", Status: "unavailable"}}}
		raw, _ := json.Marshal(s)
		require.NoError(t, singleton.DB.Create(&networkinsight.Record{Identity: identity, Kind: "bgp", ScheduledAt: scheduled, FinishedAt: s.FinishedAt, Payload: string(raw)}).Error)
	}
	data, err := readInsight(connectivityContext("1", nil), "bgp")
	require.NoError(t, err)
	require.Len(t, data.History, 3)
	require.Equal(t, now+2, data.History[1].FinishedAt)
	var count int64
	require.NoError(t, singleton.DB.Model(&networkinsight.Record{}).Count(&count).Error)
	require.EqualValues(t, 4, count)
}

func TestBGPAutomaticRetryExecutesOnlyFailedFamilyThenStops(t *testing.T) {
	setupInsight(t)
	server, _ := singleton.ServerShared.Get(1)
	require.NoError(t, singleton.DB.Create(&model.ServerIPHistory{ServerUUID: server.UUID, CurrentIP: model.IP{IPv4Addr: "1.1.1.1", IPv6Addr: "2606:4700:4700::1111"}}).Error)
	identity, _, err := insightIdentity(server)
	require.NoError(t, err)
	now := time.Now().UnixMilli()
	slot := insightClockSlot("bgp", time.Now(), 6).UnixMilli()
	initial := networkinsight.Snapshot{State: "complete", ScheduledAt: slot, StartedAt: now - 600000, FinishedAt: now - 590000, Topologies: []networkinsight.Topology{{Family: "IPv4", Status: "ok", Total: 55}, {Family: "IPv6", Status: "unavailable"}}}
	raw, _ := json.Marshal(initial)
	require.NoError(t, singleton.DB.Create(&networkinsight.Record{Identity: identity, Kind: "bgp", ScheduledAt: slot, FinishedAt: initial.FinishedAt, Payload: string(raw)}).Error)
	oldQuery, oldEnabled := queryBGP, bgpAutoEnabled.Load()
	var calls atomic.Int32
	queryBGP = func(ctx context.Context, ip, family string) networkinsight.Topology {
		calls.Add(1)
		return networkinsight.Topology{Family: family, Status: "ok", Total: 99}
	}
	bgpAutoEnabled.Store(true)
	t.Cleanup(func() {
		require.Eventually(t, func() bool { insightJobs.Lock(); defer insightJobs.Unlock(); return len(insightJobs.values) == 0 }, time.Second, 5*time.Millisecond)
		queryBGP = oldQuery
		bgpAutoEnabled.Store(oldEnabled)
	})
	require.NoError(t, launchInsight(server, "bgp", true))
	require.Eventually(t, func() bool { insightJobs.Lock(); defer insightJobs.Unlock(); return len(insightJobs.values) == 0 }, 2*time.Second, 5*time.Millisecond)
	require.EqualValues(t, 1, calls.Load(), "already successful IPv4 must not be queried again")
	got, err := insightLatest(identity, "bgp", 0)
	require.NoError(t, err)
	require.Equal(t, 2, got.AutoAttempt)
	require.Equal(t, initial.StartedAt, got.AutoFirstStartedAt)
	require.Equal(t, slot, got.ScheduledAt)
	require.Zero(t, got.AutoRetryAt)
	require.Equal(t, 55, got.Topologies[0].Total)
	require.Equal(t, initial.FinishedAt, got.Topologies[0].TestedAt)
	require.Equal(t, 99, got.Topologies[1].Total)
	require.GreaterOrEqual(t, got.Topologies[1].TestedAt, now)
	require.ErrorIs(t, launchInsight(server, "bgp", true), connectivity.ErrNotReady)
	require.EqualValues(t, 1, calls.Load())
}
