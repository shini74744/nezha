package controller

import (
	"encoding/json"
	"github.com/nezhahq/nezha/model"
	pb "github.com/nezhahq/nezha/proto"
	"github.com/nezhahq/nezha/service/connectivity"
	"github.com/nezhahq/nezha/service/networkinsight"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

type cardTestTaskStream struct {
	pb.NezhaService_RequestTaskServer
}
type cardTestStateStream struct {
	pb.NezhaService_ReportSystemStateServer
}

func TestCardSchedulerTickPersistsOrderAndSkipsDisabledAndCompleted(t *testing.T) {
	setupInsight(t)
	require.NoError(t, singleton.DB.AutoMigrate(&networkinsight.DetectionPriority{}, &connectivity.Record{}))
	oldManager := connectivityManager
	connectivityManager = connectivity.NewManager()
	oldC, oldB, oldR := connectivityAutoEnabled.Load(), bgpAutoEnabled.Load(), returnRouteAutoEnabled.Load()
	t.Cleanup(func() {
		connectivityManager = oldManager
		connectivityAutoEnabled.Store(oldC)
		bgpAutoEnabled.Store(oldB)
		returnRouteAutoEnabled.Store(oldR)
	})
	server, _ := singleton.ServerShared.Get(1)
	server.SetTaskStream(&cardTestTaskStream{})
	lease := server.AttachStateStream(&cardTestStateStream{})
	require.True(t, lease.UpdateState(&model.HostState{}, time.Now()))
	now := time.Date(2026, 10, 9, 18, 10, 0, 0, time.FixedZone("CST", 8*3600))
	priority := networkinsight.DetectionPriority{ID: 1, Order: []string{"return-route", "bgp", "connectivity", "streaming"}}
	require.NoError(t, singleton.DB.Save(&priority).Error)
	rp := networkinsight.DefaultReturnPolicy()
	rp.Enabled = true
	require.NoError(t, singleton.DB.Save(&rp).Error)
	identity, _, err := insightIdentity(server)
	require.NoError(t, err)
	var got []string
	start := func(v cardCandidate, targets []connectivity.Target) error {
		got = append(got, v.kind)
		if v.kind == "connectivity" {
			require.NotEmpty(t, targets)
			return singleton.DB.Create(&connectivity.Record{Identity: connectivityKey(v.server), Full: true, ScheduledAt: v.slot, FinishedAt: now.UnixMilli(), Payload: "{}"}).Error
		}
		raw, _ := json.Marshal(networkinsight.Snapshot{State: "complete", ScheduledAt: v.slot, FinishedAt: now.UnixMilli(), Topologies: []networkinsight.Topology{{Family: "IPv4", Status: "ok"}}})
		return singleton.DB.Create(&networkinsight.Record{Identity: identity, Kind: v.kind, ScheduledAt: v.slot, FinishedAt: now.UnixMilli(), Payload: string(raw)}).Error
	}
	// Queued/running work reserves the node, regardless of kind.
	for _, kind := range priority.Order[0:2] {
		insightJobs.Lock()
		insightJobs.values[identity+kind] = networkinsight.Snapshot{State: "queued"}
		insightJobs.Unlock()
		scheduler := cardScheduler{start: start}
		require.NoError(t, scheduler.tick(now))
		require.Empty(t, got)
		insightJobs.Lock()
		delete(insightJobs.values, identity+kind)
		insightJobs.Unlock()
	}
	for range 4 {
		// Simulate a restart between every tick: dedup must come from persistent records.
		scheduler := cardScheduler{start: start}
		require.NoError(t, scheduler.tick(now))
	}
	require.Equal(t, priority.Order, got)
	scheduler := cardScheduler{start: start}
	require.NoError(t, scheduler.tick(now))
	require.Len(t, got, 4)
	server.BGPDisabled = true
	server.ReturnRouteDisabled = true
	server.ConnectivityDisabled = true
	server.StreamingDisabled = true
	require.NoError(t, scheduler.tick(now.Add(24*time.Hour)))
	require.Len(t, got, 4)
	// Re-enabling only BGP picks up this slot without toggling other switches.
	server.BGPDisabled = false
	require.NoError(t, scheduler.tick(now.Add(24*time.Hour)))
	require.Equal(t, "bgp", got[4])
	require.Len(t, got, 5)
}
