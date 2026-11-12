package rpc

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/nezhahq/nezha/model"
	pb "github.com/nezhahq/nezha/proto"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/metadata"
)

func TestSSHIdleRPCDeliversConsecutiveReadsWithoutHeartbeatDelay(t *testing.T) {
	defer setupAuthHandshakeFixture(t)()
	h := NewNezhaHandler()
	require.NoError(t, singleton.DB.AutoMigrate(&model.SSHLoginPolicy{}, &model.SSHUnbanCommand{}, &model.SSHLoginEvent{}, &model.SSHLoginReceipt{}))
	base := metadata.NewIncomingContext(context.Background(), metadata.Pairs("client-secret", "alice-global", "client-uuid", authHandshakeUUID))
	ctx, cancel := context.WithTimeout(base, 10*time.Second)
	defer cancel()
	type result struct {
		task *pb.Task
		err  error
	}
	replies := make(chan result, 1)
	go func() {
		r, e := h.ReportSSHLogin(ctx, &pb.TaskResult{Data: `{"status":{"ban_paging":true}}`})
		replies <- result{r, e}
	}()
	require.Eventually(t, func() bool { return singleton.SSHLoginStatusFor(authHandshakeUUID).BanPaging }, time.Second, time.Millisecond)
	reader := make(chan error, 1)
	go func() { _, e := singleton.ReadSSHLocalEvents(ctx, authHandshakeUUID); reader <- e }()
	var r result
	select {
	case r = <-replies:
	case <-time.After(time.Second):
		t.Fatal("idle RPC did not wake")
	}
	require.NoError(t, r.err)
	var reply model.SSHLoginReply
	require.NoError(t, json.Unmarshal([]byte(r.task.Data), &reply))
	require.NotZero(t, reply.QueryID)
	payload, e := json.Marshal(model.SSHLoginReport{QueryID: reply.QueryID, Status: model.SSHLoginStatus{BanPaging: true}})
	require.NoError(t, e)
	// Receiving the Agent result releases the HTTP reader before the reply waits.
	go func() {
		next, e := h.ReportSSHLogin(ctx, &pb.TaskResult{Data: string(payload)})
		replies <- result{next, e}
	}()
	select {
	case e := <-reader:
		require.NoError(t, e)
	case <-time.After(time.Second):
		t.Fatal("HTTP result waited for idle RPC reply")
	}
	nextReadCtx, nextCancel := context.WithCancel(ctx)
	nextReader := make(chan error, 1)
	go func() {
		_, e := singleton.ReadSSHLocalBans(nextReadCtx, authHandshakeUUID, "", 2, 100)
		nextReader <- e
	}()
	select {
	case r = <-replies:
	case <-time.After(time.Second):
		t.Fatal("consecutive read waited for next heartbeat")
	}
	require.NoError(t, r.err)
	require.NoError(t, json.Unmarshal([]byte(r.task.Data), &reply))
	require.NotNil(t, reply.BanQuery)
	require.Equal(t, 2, reply.BanQuery.Page)
	nextCancel()
	require.ErrorIs(t, <-nextReader, context.Canceled)
	<-h.StopReports()
}
