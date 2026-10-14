package controller

import (
	"context"
	"github.com/nezhahq/nezha/model"
	pb "github.com/nezhahq/nezha/proto"
	"github.com/nezhahq/nezha/service/connectivity"
	"github.com/nezhahq/nezha/service/latency"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

type latencyRecordingStream struct {
	pb.NezhaService_RequestTaskServer
	tasks chan *pb.Task
}

func (s *latencyRecordingStream) Send(task *pb.Task) error {
	s.tasks <- task
	return model.ErrTaskStreamOffline
}

func TestLatencySchedulerDispatchesBothStacksAndOnlyPersistsAutomaticBatch(t *testing.T) {
	setupLatency(t)
	server, _ := singleton.ServerShared.Get(1)
	stream := &latencyRecordingStream{tasks: make(chan *pb.Task, 16)}
	server.SetTaskStream(stream)
	require.True(t, server.AttachStateStream(&cardTestStateStream{}).UpdateState(&model.HostState{}, time.Now()))
	require.NoError(t, singleton.DB.Create(&model.ServerIPHistory{ServerUUID: server.UUID, CurrentIP: model.IP{IPv4Addr: "8.8.8.8", IPv6Addr: "2606:4700:4700::1111"}}).Error)
	settings := latency.Defaults()
	settings.Enabled = true
	settings.Targets = settings.Targets[:1]
	v6 := "2606:4700:4700::1111"
	settings.Targets[0].Host, settings.Targets[0].IPv6Host = "8.8.8.8", &v6
	require.NoError(t, singleton.DB.Save(&settings).Error)
	completed := make(chan connectivity.Snapshot, 2)
	latencyManager.SetCompletionHandler(func(key string, s connectivity.Snapshot) { persistLatencySnapshot(key, s); completed <- s })
	now := time.Now()
	require.NoError(t, latencySchedulerTick(now))
	var snap connectivity.Snapshot
	select {
	case snap = <-completed:
	case <-time.After(5 * time.Second):
		t.Fatal("automatic batch did not complete")
	}
	require.Equal(t, connectivity.ClockSlot(now, 2).UnixMilli(), snap.ScheduledAt)
	require.Len(t, snap.Results, 2)
	seen := map[string]bool{}
	taskIDs := map[uint64]bool{}
	for range 2 {
		select {
		case task := <-stream.tasks:
			require.EqualValues(t, model.TaskTypeTCPPing, task.Type)
			require.False(t, taskIDs[task.Id])
			taskIDs[task.Id] = true
			seen[task.Data] = true
		default:
			t.Fatal("both stack tasks must be dispatched")
		}
	}
	require.Equal(t, map[string]bool{"8.8.8.8:80": true, "[2606:4700:4700::1111]:80": true}, seen)
	var row latency.Record
	require.NoError(t, singleton.DB.First(&row).Error)
	saved, err := latency.Decode(row)
	require.NoError(t, err)
	require.Len(t, saved.Results, 2)
	require.Equal(t, "IPv4", saved.Results[0].Family)
	require.Equal(t, "IPv6", saved.Results[1].Family)
	require.Equal(t, snap.ScheduledAt, saved.ScheduledAt)
	// Manual results remain usable, without writing another retained record.
	targets := settings.Probes([]string{"IPv4", "IPv6"})
	_, err = latencyManager.StartImmediate(connectivityKey(server), "", func(context.Context, connectivity.Target) connectivity.Sample {
		return connectivity.Sample{Status: "ok"}
	}, targets)
	require.NoError(t, err)
	select {
	case snap = <-completed:
	case <-time.After(5 * time.Second):
		t.Fatal("manual batch did not complete")
	}
	require.Zero(t, snap.ScheduledAt)
	require.Equal(t, "complete", latencyManager.Get(connectivityKey(server), targets).State)
	var count int64
	require.NoError(t, singleton.DB.Model(&latency.Record{}).Count(&count).Error)
	require.EqualValues(t, 1, count)
}
