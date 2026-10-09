package rpc

import (
	"context"
	"github.com/nezhahq/nezha/model"
	pb "github.com/nezhahq/nezha/proto"
	"github.com/nezhahq/nezha/service/networkinsight"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"strings"
	"testing"
	"time"
)

func TestReturnProbeSessionSizeAndIndependentSwitch(t *testing.T) {
	s := requestTaskSecurityServer(7, 200, "return-fixture")
	setupRequestTaskSecurityFixture(t, []*model.Server{s}, nil, nil, nil)
	s, _ = singleton.ServerShared.Get(7)
	s.AttachStateStream(stateGenerationStream{}).UpdateState(&model.HostState{}, time.Now())
	_, err := s.RuntimeHandle().ApplyHostReport(&model.Host{Platform: "linux"}, time.Now(), nil)
	require.NoError(t, err)
	stream := &requestTaskSecurityStream{ctx: context.Background()}
	sent := 0
	stream.onSend = func(task *pb.Task) {
		sent++
		require.Contains(t, task.Data, "nexttrace-tiny")
		require.Contains(t, task.Data, "1.1.1.1")
		wrong := &pb.TaskResult{Id: task.Id, Type: task.Type, Successful: true, Data: "bad"}
		require.True(t, deliverMediaResult(wrong, 8, stream))
		deliverMediaResult(&pb.TaskResult{Id: task.Id, Type: task.Type, Successful: true, Data: "NZR|0\n" + strings.Repeat(" ", 5000) + `{"Hops":[[{"Success":true,"Address":{"IP":"1.1.1.1"},"TTL":1,"RTT":1000000}]]}`}, 7, stream)
	}
	s.SetTaskStream(stream)
	s.BGPDisabled = true
	s.StreamingDisabled = true
	probe := ReturnRouteProbe(s)
	base := networkinsight.ReturnResult{Target: "1.1.1.1", Family: "IPv4", Protocol: "tcp"}
	require.Equal(t, "reached", probe(context.Background(), base).Status)
	require.Equal(t, 1, sent)
	s.ReturnRouteDisabled = true
	require.Equal(t, "offline", probe(context.Background(), base).Status)
	require.Equal(t, 1, sent)
	s.ReturnRouteDisabled = false
	s.SetTaskStream(&requestTaskSecurityStream{ctx: context.Background()})
	require.Equal(t, "offline", probe(context.Background(), base).Status)
}
