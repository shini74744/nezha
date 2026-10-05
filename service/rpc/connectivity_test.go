package rpc

import (
	"context"
	"github.com/nezhahq/nezha/model"
	pb "github.com/nezhahq/nezha/proto"
	"github.com/nezhahq/nezha/service/connectivity"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"math"
	"sync/atomic"
	"testing"
	"time"
)

func TestConnectivityClassification(t *testing.T) {
	cases := []struct {
		data, status string
		code         int
	}{
		{"\n应用错误: 403 Forbidden", "http_error", 403}, {"HTTP 429 Too Many Requests", "http_error", 429},
		{"application error: 500 Internal Server Error", "http_error", 500},
		{"Get https://x: lookup x on 10.0.0.2: no such host", "dns_error", 0},
		{"tls: failed to verify certificate: x509: expired", "tls_error", 0},
		{"context deadline exceeded", "timeout", 0}, {"connection refused", "refused", 0},
		{"network is unreachable", "unreachable", 0}, {"This server has disabled query sending", "query_disabled", 0},
		{"secret=do-not-leak internal 10.0.0.2", "error", 0},
	}
	for _, tt := range cases {
		t.Run(tt.status+tt.data, func(t *testing.T) {
			r := classifyConnectivityResult(&pb.TaskResult{Data: tt.data, Delay: 123})
			require.Equal(t, tt.status, r.Status)
			require.Equal(t, tt.code, r.HTTPStatus)
			if tt.code != 0 {
				require.Equal(t, 123.0, *r.DelayMS)
			} else {
				require.Nil(t, r.DelayMS)
			}
		})
	}
	r := classifyConnectivityResult(&pb.TaskResult{Successful: true, Delay: 0})
	require.Equal(t, "ok", r.Status)
	require.NotNil(t, r.DelayMS)
	for _, v := range []float32{-1, float32(math.NaN()), float32(math.Inf(1)), 1e9} {
		require.Nil(t, classifyConnectivityResult(&pb.TaskResult{Successful: true, Delay: v}).DelayMS)
	}
}
func TestConnectivityResultIdentityDuplicateAndLate(t *testing.T) {
	stream := &requestTaskSecurityStream{ctx: context.Background()}
	id := connectivityTaskMask | 123
	w := &connectivityWaiter{serverID: 7, stream: stream, result: make(chan *pb.TaskResult, 1)}
	connectivityWaiters.Store(id, w)
	defer connectivityWaiters.Delete(id)
	r := &pb.TaskResult{Id: id, Type: model.TaskTypeHTTPGet, Successful: true}
	require.True(t, deliverConnectivityResult(r, 8, stream))
	require.Empty(t, w.result)
	require.True(t, deliverConnectivityResult(r, 7, &requestTaskSecurityStream{}))
	require.Empty(t, w.result)
	require.False(t, deliverConnectivityResult(&pb.TaskResult{Id: id, Type: model.TaskTypeCommand}, 7, stream))
	require.False(t, deliverConnectivityResult(&pb.TaskResult{Id: 1, Type: model.TaskTypeHTTPGet}, 7, stream))
	require.True(t, deliverConnectivityResult(r, 7, stream))
	require.Len(t, w.result, 1)
	require.True(t, deliverConnectivityResult(r, 7, stream))
	require.Len(t, w.result, 1)
	connectivityWaiters.Delete(id)
	require.True(t, deliverConnectivityResult(r, 7, stream), "late probe results must not enter monitor history")
}
func TestConnectivityUsesAgentHTTPOnlyAndPinsSession(t *testing.T) {
	server := requestTaskSecurityServer(7, 200, "connectivity-fixture")
	setupRequestTaskSecurityFixture(t, []*model.Server{server}, nil, map[uint64]model.UserInfo{200: {Role: model.RoleMember}}, nil)
	server, _ = singleton.ServerShared.Get(7)
	server.AttachStateStream(stateGenerationStream{}).UpdateState(&model.HostState{}, time.Now())
	stream := &requestTaskSecurityStream{ctx: context.Background()}
	sent := 0
	stream.onSend = func(task *pb.Task) {
		sent++
		require.EqualValues(t, model.TaskTypeHTTPGet, task.Type)
		target, _ := connectivity.FindTarget("google")
		require.Equal(t, target.URL, task.Data)
		deliverConnectivityResult(&pb.TaskResult{Id: task.Id, Type: task.Type, Successful: true, Delay: 8.5}, 7, stream)
	}
	server.SetTaskStream(stream)
	probe := ConnectivityProbe(server)
	target, _ := connectivity.FindTarget("google")
	target.URL = "http://169.254.169.254/"
	got := probe(context.Background(), target)
	require.Equal(t, "ok", got.Status)
	require.Equal(t, 8.5, *got.DelayMS)
	require.Equal(t, 1, sent)
	require.Equal(t, "error", probe(context.Background(), connectivity.Target{ID: "custom", URL: "http://127.0.0.1"}).Status)
	server.SetTaskStream(&requestTaskSecurityStream{ctx: context.Background()})
	require.Equal(t, "offline", probe(context.Background(), target).Status)
	require.Equal(t, 1, sent)
	server.SetTaskStream(stream)
	server.SetUserID(300)
	require.Equal(t, "offline", probe(context.Background(), target).Status)
}
func TestConnectivityTimeoutRemovesWaiter(t *testing.T) {
	server := requestTaskSecurityServer(7, 200, "timeout-fixture")
	setupRequestTaskSecurityFixture(t, []*model.Server{server}, nil, nil, nil)
	server, _ = singleton.ServerShared.Get(7)
	server.AttachStateStream(stateGenerationStream{}).UpdateState(&model.HostState{}, time.Now())
	stream := &requestTaskSecurityStream{ctx: context.Background()}
	var taskID uint64
	stream.onSend = func(task *pb.Task) { taskID = task.Id }
	server.SetTaskStream(stream)
	target, _ := connectivity.FindTarget("google")
	start := time.Now()
	require.Equal(t, 3*time.Second, connectivityProbeTimeout)
	require.Equal(t, "agent_timeout", ConnectivityProbe(server)(context.Background(), target).Status)
	require.GreaterOrEqual(t, time.Since(start), 2900*time.Millisecond)
	require.Less(t, time.Since(start), 4500*time.Millisecond)
	_, ok := connectivityWaiters.Load(taskID)
	require.False(t, ok)
	require.True(t, deliverConnectivityResult(&pb.TaskResult{Id: taskID, Type: model.TaskTypeHTTPGet}, 7, stream))
}

type connectivityLoopbackAgent struct {
	*requestTaskSecurityStream
	replies chan *pb.TaskResult
	sent    atomic.Int32
}

func (s *connectivityLoopbackAgent) Send(task *pb.Task) error {
	s.sent.Add(1)
	// Agent-side fixture: no outbound traffic is used during this test.
	result := &pb.TaskResult{Id: task.Id, Type: task.Type, Successful: true, Delay: 42}
	if task.Data == "https://chatgpt.com/cdn-cgi/trace" {
		result.Successful = false
		result.Data = "应用错误: 403 Forbidden"
	}
	select {
	case s.replies <- result:
		return nil
	case <-s.ctx.Done():
		return s.ctx.Err()
	}
}
func (s *connectivityLoopbackAgent) Recv() (*pb.TaskResult, error) {
	select {
	case result := <-s.replies:
		return result, nil
	case <-s.ctx.Done():
		return nil, s.ctx.Err()
	}
}
func TestConnectivityFullAgentTaskChannelDoesNotTouchMonitorHistory(t *testing.T) {
	server := requestTaskSecurityServer(7, 200, "11111111-1111-4111-8111-111111111111")
	setupRequestTaskSecurityFixture(t, []*model.Server{server}, nil, map[uint64]model.UserInfo{200: {Role: model.RoleMember}}, map[string]uint64{"fixture-secret": 200})
	server, _ = singleton.ServerShared.Get(7)
	server.AttachStateStream(stateGenerationStream{}).UpdateState(&model.HostState{}, time.Now())
	base := requestTaskSecurityAuthedStream("fixture-secret", server.UUID)
	ctx, cancel := context.WithCancel(base.ctx)
	base.ctx = ctx
	stream := &connectivityLoopbackAgent{requestTaskSecurityStream: base, replies: make(chan *pb.TaskResult, 64)}
	done := make(chan error, 1)
	go func() { done <- NewNezhaHandler().RequestTask(stream) }()
	defer func() { cancel(); require.ErrorIs(t, <-done, context.Canceled) }()
	require.Eventually(t, func() bool { return server.GetTaskStream() == stream }, time.Second, time.Millisecond)
	// Nil sentinel is intentional: accidentally routing a probe into existing
	// service monitoring would panic instead of quietly contaminating history.
	previous := singleton.ServiceSentinelShared
	singleton.ServiceSentinelShared = nil
	defer func() { singleton.ServiceSentinelShared = previous }()
	manager := connectivity.NewManager()
	_, err := manager.Start("fixture", ConnectivityProbe(server))
	require.NoError(t, err)
	require.Eventually(t, func() bool { return manager.Get("fixture").State == "complete" }, 2*time.Second, time.Millisecond)
	snapshot := manager.Get("fixture")
	require.EqualValues(t, 3*len(connectivity.Targets()), stream.sent.Load())
	for _, result := range snapshot.Results {
		if result.ID == "chatgpt" {
			require.Equal(t, "http_error", result.Status)
			require.Equal(t, 403, result.Samples[0].HTTPStatus)
		} else {
			require.Equal(t, "ok", result.Status)
		}
		require.Equal(t, 42.0, *result.DelayMS)
	}
}

func TestConnectivitySlowAgentReplyDoesNotBlockOtherSitesAndStillSamplesThreeTimes(t *testing.T) {
	server := requestTaskSecurityServer(7, 200, "fair-timeout-fixture")
	setupRequestTaskSecurityFixture(t, []*model.Server{server}, nil, nil, nil)
	server, _ = singleton.ServerShared.Get(7)
	server.AttachStateStream(stateGenerationStream{}).UpdateState(&model.HostState{}, time.Now())
	stream := &requestTaskSecurityStream{ctx: context.Background()}
	slow := connectivity.Targets()[0]
	var slowCalls atomic.Int32
	stream.onSend = func(task *pb.Task) {
		if task.Data == slow.URL {
			slowCalls.Add(1)
			return
		}
		deliverConnectivityResult(&pb.TaskResult{Id: task.Id, Type: task.Type, Successful: true, Delay: 12}, 7, stream)
	}
	server.SetTaskStream(stream)
	manager := connectivity.NewManager()
	_, err := manager.Start("fair-3s", ConnectivityProbe(server))
	require.NoError(t, err)
	// All later fast sites can finish while the very first Agent request is silent.
	require.Eventually(t, func() bool {
		s := manager.Get("fair-3s")
		for _, row := range s.Results[1:] {
			if row.Phase != "complete" {
				return false
			}
		}
		return s.Results[0].Phase == "running"
	}, 2*time.Second, 5*time.Millisecond)
	require.Eventually(t, func() bool { return manager.Get("fair-3s").State == "complete" }, 12*time.Second, 10*time.Millisecond)
	s := manager.Get("fair-3s")
	require.EqualValues(t, 3, slowCalls.Load())
	require.Len(t, s.Results[0].Samples, 3)
	require.Equal(t, "agent_timeout", s.Results[0].Status)
	for _, row := range s.Results[1:] {
		require.Equal(t, "ok", row.Status)
		require.Len(t, row.Samples, 3)
	}
}
