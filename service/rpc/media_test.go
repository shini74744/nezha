package rpc

import (
	"context"
	"github.com/nezhahq/nezha/model"
	pb "github.com/nezhahq/nezha/proto"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func TestMediaReplyIdentityTypeLateAndSize(t *testing.T) {
	stream := &requestTaskSecurityStream{}
	id := mediaTaskMask | 987
	w := &mediaWaiter{serverID: 7, stream: stream, result: make(chan *pb.TaskResult, 1)}
	mediaWaiters.Store(id, w)
	defer mediaWaiters.Delete(id)
	result := &pb.TaskResult{Id: id, Type: model.TaskTypeCommand, Successful: true, Data: "NZM|0|200|0|premium,|US"}
	require.True(t, deliverMediaResult(result, 8, stream))
	require.Empty(t, w.result)
	require.True(t, deliverMediaResult(result, 7, &requestTaskSecurityStream{}))
	require.Empty(t, w.result)
	require.True(t, deliverMediaResult(&pb.TaskResult{Id: id, Type: model.TaskTypeHTTPGet}, 7, stream))
	require.Empty(t, w.result)
	require.True(t, deliverMediaResult(result, 7, stream))
	require.Len(t, w.result, 1)
	<-w.result
	result.Data = string(make([]byte, 5000))
	require.True(t, deliverMediaResult(result, 7, stream))
	require.Empty(t, (<-w.result).Data)
	mediaWaiters.Delete(id)
	require.True(t, deliverMediaResult(result, 7, stream))
	require.False(t, deliverMediaResult(&pb.TaskResult{Id: 123, Type: model.TaskTypeCommand}, 7, stream))
}

func TestMediaProbeDispatchIsFixedAndBoundToAgentSession(t *testing.T) {
	server := requestTaskSecurityServer(7, 200, "media-fixture")
	server.Host = &model.Host{Platform: "linux"}
	setupRequestTaskSecurityFixture(t, []*model.Server{server}, nil, nil, nil)
	server, _ = singleton.ServerShared.Get(7)
	server.AttachStateStream(stateGenerationStream{}).UpdateState(&model.HostState{}, time.Now())
	// Fixtures initialize runtime before test host mutation, so apply host through the holder.
	_, err := server.RuntimeHandle().ApplyHostReport(&model.Host{Platform: "linux"}, time.Now(), nil)
	require.NoError(t, err)
	stream := &requestTaskSecurityStream{ctx: context.Background()}
	sent := 0
	stream.onSend = func(task *pb.Task) {
		sent++
		require.EqualValues(t, model.TaskTypeCommand, task.Type)
		require.Contains(t, task.Data, "https://www.youtube.com/premium")
		require.Contains(t, task.Data, "--max-time 8")
		require.NotContains(t, task.Data, "curl -k")
		deliverMediaResult(&pb.TaskResult{Id: task.Id, Type: task.Type, Successful: true, Data: "NZM|0|200|0|premium,|US"}, 7, stream)
	}
	server.SetTaskStream(stream)
	probe := MediaProbe(server)
	require.Equal(t, "unlocked", probe(context.Background(), "youtube", "IPv4").Status)
	require.Equal(t, 1, sent)
	require.Equal(t, "unknown", probe(context.Background(), "bad; command", "IPv4").Status)
	server.StreamingDisabled = true
	require.Equal(t, "offline", probe(context.Background(), "youtube", "IPv4").Status)
	server.StreamingDisabled = false
	server.SetTaskStream(&requestTaskSecurityStream{ctx: context.Background()})
	require.Equal(t, "offline", probe(context.Background(), "youtube", "IPv4").Status)
	require.Equal(t, 1, sent)
}

func TestInsightIPv6DiscoveryUsesBGPAgentAndSwitch(t *testing.T) {
	server := requestTaskSecurityServer(7, 200, "ipv6-fixture")
	setupRequestTaskSecurityFixture(t, []*model.Server{server}, nil, nil, nil)
	server, _ = singleton.ServerShared.Get(7)
	server.AttachStateStream(stateGenerationStream{}).UpdateState(&model.HostState{}, time.Now())
	_, err := server.RuntimeHandle().ApplyHostReport(&model.Host{Platform: "linux"}, time.Now(), nil)
	require.NoError(t, err)
	stream := &requestTaskSecurityStream{ctx: context.Background()}
	sent := 0
	stream.onSend = func(task *pb.Task) {
		sent++
		require.Contains(t, task.Data, "curl -q -6")
		require.Contains(t, task.Data, "https://api6.ipify.org")
		deliverMediaResult(&pb.TaskResult{Id: task.Id, Type: task.Type, Successful: true, Data: "2606:4700:4700::1111"}, 7, stream)
	}
	server.SetTaskStream(stream)
	server.StreamingDisabled = true
	require.Equal(t, "2606:4700:4700::1111", InsightIPv6(context.Background(), server))
	require.Equal(t, 1, sent)
	server.BGPDisabled = true
	require.Empty(t, InsightIPv6(context.Background(), server))
	require.Equal(t, 1, sent)
}
func TestConnectionIPPreservesActualFamily(t *testing.T) {
	require.Equal(t, model.IP{IPv6Addr: "2606:4700:4700::1111"}, connectionIP("2606:4700:4700::1111"))
	require.Equal(t, model.IP{IPv4Addr: "1.1.1.1"}, connectionIP("::ffff:1.1.1.1"))
	require.Empty(t, connectionIP("bad"))
}
