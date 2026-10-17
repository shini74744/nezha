package rpc

import (
	"context"
	"github.com/nezhahq/nezha/model"
	pb "github.com/nezhahq/nezha/proto"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/test/bufconn"
	"net"
	"testing"
	"time"
)

func TestReplacementRealTransportStagesUntilFirstState(t *testing.T) {
	server := &model.Server{Common: model.Common{ID: 7, UserID: 1}, UUID: "11111111-1111-4111-8111-111111111111", Name: "fixture"}
	setupApplyConfigAuthzFixture(t, []*model.Server{server}, map[uint64]model.UserInfo{1: {Role: model.RoleAdmin}}, map[string]uint64{"owner-fixture": 1})
	require.NoError(t, singleton.DB.AutoMigrate(&model.Transfer{}, &model.ServerSnapshot{}, &model.ServiceHistory{}, &model.PlanTrafficCheckpoint{}, &model.PlanTrafficDay{}, &model.ServerIPHistory{}, &model.AgentUUIDConflict{}))
	prepareFullReplacementSchema(t)
	require.NoError(t, singleton.DB.Create(&model.Transfer{ServerID: 7, In: 100}).Error)
	listener := bufconn.Listen(1 << 20)
	rpcServer := grpc.NewServer()
	pb.RegisterNezhaServiceServer(rpcServer, NewNezhaHandler())
	go func() { _ = rpcServer.Serve(listener) }()
	defer rpcServer.Stop()
	client := func() (pb.NezhaServiceClient, *grpc.ClientConn) {
		conn, err := grpc.NewClient("passthrough:///fixture", grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) { return listener.Dial() }), grpc.WithTransportCredentials(insecure.NewCredentials()))
		require.NoError(t, err)
		return pb.NewNezhaServiceClient(conn), conn
	}
	parent, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	auth := func(secret string) context.Context {
		return metadata.NewOutgoingContext(parent, metadata.Pairs("client-secret", secret, "client-uuid", server.UUID))
	}
	a, connA := client()
	defer connA.Close()
	_, err := a.ReportSystemInfo2(auth("owner-fixture"), &pb.Host{Platform: "debian", BootTime: 500})
	require.NoError(t, err)
	secret, _, err := singleton.IssueServerReplacement(server.UUID, model.ServerOperationActor{ID: 1})
	require.NoError(t, err)
	b, connB := client()
	defer connB.Close()
	ctx := auth(secret)
	_, err = b.ReportSystemInfo2(ctx, &pb.Host{Platform: "ubuntu", PlatformVersion: "24.04", BootTime: 100})
	require.NoError(t, err)
	live, _ := singleton.ServerShared.Get(7)
	require.Equal(t, "debian", live.RuntimeSnapshot().Host.Platform)
	var count int64
	require.NoError(t, singleton.DB.Model(&model.Transfer{}).Where("server_id = ?", 7).Count(&count).Error)
	require.EqualValues(t, 1, count)
	proxied, splitConn := client()
	defer splitConn.Close()
	stream, err := proxied.ReportSystemState(ctx)
	require.NoError(t, err)
	require.NoError(t, stream.Send(&pb.State{NetInTransfer: 999999, NetOutTransfer: 888888, Uptime: 100}))
	receipt, err := stream.Recv()
	require.NoError(t, err)
	require.True(t, receipt.Proced)
	live, _ = singleton.ServerShared.Get(7)
	require.Equal(t, "ubuntu", live.RuntimeSnapshot().Host.Platform)
	require.NoError(t, singleton.DB.Model(&model.Transfer{}).Where("server_id = ?", 7).Count(&count).Error)
	require.Zero(t, count)
	// Active token survives reconnect and cannot clear newly collected data again.
	require.NoError(t, singleton.DB.Create(&model.Transfer{ServerID: 7, In: 20}).Error)
	_, err = b.ReportSystemInfo2(ctx, &pb.Host{Platform: "ubuntu", BootTime: 100})
	require.NoError(t, err)
	require.NoError(t, singleton.DB.Model(&model.Transfer{}).Where("server_id = ?", 7).Count(&count).Error)
	require.EqualValues(t, 1, count)
	_ = stream.CloseSend()
}

// Full replacement now includes node associations and configuration. The RPC
// fixture must contain the same tables as application startup, not only traffic.
func prepareFullReplacementSchema(t *testing.T) {
	t.Helper()
	require.NoError(t, singleton.DB.AutoMigrate(
		&model.NAT{}, &model.ServerGroupServer{}, &model.MCPAuditLog{},
		&model.Cron{}, &model.Service{}, &model.AlertRule{}, &model.APIToken{},
	))
}
