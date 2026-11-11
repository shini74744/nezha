package rpc

import (
	"context"
	"github.com/nezhahq/nezha/model"
	pb "github.com/nezhahq/nezha/proto"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"strings"
	"testing"
)

func TestSSHReportAuthenticatesAndStopsBeforeMutation(t *testing.T) {
	defer setupAuthHandshakeFixture(t)()
	h := NewNezhaHandler()
	_, e := h.ReportSSHLogin(context.Background(), &pb.TaskResult{Data: "{}"})
	require.Equal(t, codes.Unauthenticated, status.Code(e))
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs("client-secret", "alice-global", "client-uuid", authHandshakeUUID))
	require.NoError(t, singleton.DB.AutoMigrate(&model.SSHLoginPolicy{}, &model.SSHUnbanCommand{}, &model.SSHLoginEvent{}, &model.SSHLoginReceipt{}))
	_, e = h.ReportSSHLogin(ctx, &pb.TaskResult{Data: strings.Repeat("x", 262145)})
	require.Equal(t, codes.InvalidArgument, status.Code(e))
	_, e = h.ReportSSHLogin(ctx, &pb.TaskResult{Data: "{"})
	require.Equal(t, codes.InvalidArgument, status.Code(e))
	reply, e := h.ReportSSHLogin(ctx, &pb.TaskResult{Data: `{"uuid":"another-server","status":{"banned":["192.0.2.10"]}}`})
	require.NoError(t, e)
	require.Contains(t, reply.Data, "policy")
	require.Equal(t, []string{"192.0.2.10"}, singleton.SSHLoginStatusFor(authHandshakeUUID).Banned)
	require.Zero(t, singleton.SSHLoginStatusFor("another-server").UpdatedAt)
	<-h.StopReports()
	_, e = h.ReportSSHLogin(ctx, &pb.TaskResult{Data: "{}"})
	require.Equal(t, codes.Unavailable, status.Code(e))
}
