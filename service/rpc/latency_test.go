package rpc

import (
	"context"
	"github.com/nezhahq/nezha/model"
	pb "github.com/nezhahq/nezha/proto"
	"github.com/nezhahq/nezha/service/connectivity"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func TestLatencyPinnedTCPTaskAndLateReplies(t *testing.T) {
	server := requestTaskSecurityServer(7, 200, "latency-fixture")
	setupRequestTaskSecurityFixture(t, []*model.Server{server}, nil, map[uint64]model.UserInfo{200: {Role: model.RoleMember}}, nil)
	server, _ = singleton.ServerShared.Get(7)
	server.AttachStateStream(stateGenerationStream{}).UpdateState(&model.HostState{}, time.Now())
	stream := &requestTaskSecurityStream{ctx: context.Background()}
	sent := 0
	target := connectivity.Target{ID: "test", URL: "8.8.8.8:80"}
	stream.onSend = func(task *pb.Task) {
		sent++
		require.EqualValues(t, model.TaskTypeTCPPing, task.Type)
		require.Equal(t, "8.8.8.8:80", task.Data)
		require.True(t, deliverLatencyResult(&pb.TaskResult{Id: task.Id, Type: task.Type, Successful: true, Delay: 8.5}, 8, stream))
		require.True(t, deliverLatencyResult(&pb.TaskResult{Id: task.Id, Type: task.Type, Successful: true, Delay: 8.5}, 7, stream))
	}
	server.SetTaskStream(stream)
	probe := LatencyProbe(server, []connectivity.Target{target})
	target.URL = "127.0.0.1:80"
	got := probe(context.Background(), target)
	require.Equal(t, "ok", got.Status)
	require.Equal(t, 8.5, *got.DelayMS)
	require.Equal(t, 1, sent)
	server.SetTaskStream(&requestTaskSecurityStream{ctx: context.Background()})
	require.Equal(t, "offline", probe(context.Background(), target).Status)
	require.Equal(t, 1, sent)
	require.True(t, deliverLatencyResult(&pb.TaskResult{Id: latencyTaskMask | 99999, Type: model.TaskTypeTCPPing}, 7, stream))
	require.False(t, deliverLatencyResult(&pb.TaskResult{Id: latencyTaskMask | 99999, Type: model.TaskTypeHTTPGet}, 7, stream))
}
func TestLatencyPublicAddressRestriction(t *testing.T) {
	for _, target := range []string{"127.0.0.1:80", "10.1.1.1:80", "169.254.169.254:80", "[::1]:80", "100.64.0.1:80"} {
		_, e := publicLatencyAddress(context.Background(), target)
		require.Error(t, e, target)
	}
	got, e := publicLatencyAddress(context.Background(), "8.8.8.8:80")
	require.NoError(t, e)
	require.Equal(t, "8.8.8.8:80", got)
}

func TestLatencyExplicitFamilyNeverFallsBack(t *testing.T) {
	for _, tc := range []struct {
		target, family string
		ok             bool
	}{
		{"8.8.8.8:80", "IPv4", true},
		{"[2606:4700:4700::1111]:80", "IPv6", true},
		{"8.8.8.8:80", "IPv6", false},
		{"[2606:4700:4700::1111]:80", "IPv4", false},
		{"[fc00::1]:80", "IPv6", false},
		{"8.8.8.8:80", "other", false},
	} {
		got, err := publicLatencyAddress(context.Background(), tc.target, tc.family)
		if tc.ok {
			require.NoError(t, err)
			require.Equal(t, tc.target, got)
		} else {
			require.Error(t, err)
		}
	}
}

func TestLatencyPinnedIPv6TaskCannotBecomeIPv4(t *testing.T) {
	server := requestTaskSecurityServer(7, 200, "latency-v6-fixture")
	setupRequestTaskSecurityFixture(t, []*model.Server{server}, nil, map[uint64]model.UserInfo{200: {Role: model.RoleMember}}, nil)
	server, _ = singleton.ServerShared.Get(7)
	server.AttachStateStream(stateGenerationStream{}).UpdateState(&model.HostState{}, time.Now())
	stream := &requestTaskSecurityStream{ctx: context.Background()}
	stream.onSend = func(task *pb.Task) {
		require.EqualValues(t, model.TaskTypeTCPPing, task.Type)
		require.Equal(t, "[2606:4700:4700::1111]:80", task.Data)
		deliverLatencyResult(&pb.TaskResult{Id: task.Id, Type: task.Type, Successful: true, Delay: 66}, 7, stream)
	}
	server.SetTaskStream(stream)
	target := connectivity.Target{ID: "test@IPv6", URL: "[2606:4700:4700::1111]:80", Family: "IPv6"}
	probe := LatencyProbe(server, []connectivity.Target{target})
	target.URL = "8.8.8.8:80"
	target.Family = "IPv4"
	got := probe(context.Background(), target)
	require.Equal(t, "ok", got.Status)
	require.Equal(t, 66.0, *got.DelayMS)
}

func TestLatencyDualStackTasksAndResultsAreIndependent(t *testing.T) {
	server := requestTaskSecurityServer(7, 200, "latency-dual-fixture")
	setupRequestTaskSecurityFixture(t, []*model.Server{server}, nil, map[uint64]model.UserInfo{200: {Role: model.RoleMember}}, nil)
	server, _ = singleton.ServerShared.Get(7)
	server.AttachStateStream(stateGenerationStream{}).UpdateState(&model.HostState{}, time.Now())
	stream := &requestTaskSecurityStream{ctx: context.Background()}
	tasks := make(chan *pb.Task, 2)
	stream.onSend = func(task *pb.Task) { tasks <- task }
	server.SetTaskStream(stream)
	targets := []connectivity.Target{
		{ID: "test", URL: "8.8.8.8:80", Family: "IPv4"},
		{ID: "test@IPv6", URL: "[2606:4700:4700::1111]:80", Family: "IPv6"},
	}
	probe := LatencyProbe(server, targets)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	replies := make([]chan connectivity.Sample, 2)
	for i, target := range targets {
		replies[i] = make(chan connectivity.Sample, 1)
		go func(out chan connectivity.Sample, target connectivity.Target) { out <- probe(ctx, target) }(replies[i], target)
	}
	seen := map[uint64]bool{}
	addresses := map[string]bool{}
	for range targets {
		select {
		case task := <-tasks:
			require.EqualValues(t, model.TaskTypeTCPPing, task.Type)
			require.False(t, seen[task.Id])
			seen[task.Id], addresses[task.Data] = true, true
			result := &pb.TaskResult{Id: task.Id, Type: task.Type}
			if task.Data == "8.8.8.8:80" {
				result.Successful, result.Delay = true, 23
			} else {
				result.Data = "network is unreachable"
			}
			require.True(t, deliverLatencyResult(result, 7, stream))
		case <-ctx.Done():
			t.Fatal("independent tasks were not dispatched")
		}
	}
	require.Equal(t, map[string]bool{"8.8.8.8:80": true, "[2606:4700:4700::1111]:80": true}, addresses)
	v4, v6 := <-replies[0], <-replies[1]
	require.Equal(t, "ok", v4.Status)
	require.NotNil(t, v4.DelayMS)
	require.Equal(t, 23.0, *v4.DelayMS)
	require.Equal(t, "unreachable", v6.Status)
	require.Nil(t, v6.DelayMS)
}
