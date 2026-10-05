package rpc

import (
	"context"
	"net"
	"testing"
	"time"

	"github.com/nezhahq/nezha/model"
	pb "github.com/nezhahq/nezha/proto"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/test/bufconn"
)

const cleanupRPCUUID = "aa777777-1111-4111-8111-111111111111"

func setupCleanupRPC(t *testing.T) (pb.NezhaServiceClient, *model.ServerDeletionTombstone) {
	t.Helper()
	t.Cleanup(setupAuthHandshakeFixture(t))
	sqlDB, err := singleton.DB.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	require.NoError(t, singleton.DB.AutoMigrate(&model.ServerDeletionTombstone{}, &model.ServerGroupServer{}, &model.Transfer{},
		&model.NAT{}, &model.MCPAuditLog{}, &model.Cron{}, &model.Service{}, &model.AlertRule{}, &model.APIToken{}))
	removed := &model.Server{Common: model.Common{ID: 12, UserID: 100}, UUID: cleanupRPCUUID, Name: "cleanup fixture"}
	require.NoError(t, singleton.DB.Create(removed).Error)
	model.InitServer(removed)
	_, err = removed.RuntimeHandle().ApplyHostReport(&model.Host{Platform: "ubuntu"}, time.Now(), nil)
	require.NoError(t, err)
	singleton.ServerShared.Update(removed, removed.UUID)
	require.NoError(t, singleton.PermanentlyDeleteServers([]uint64{12}))
	t.Cleanup(func() { _, _ = singleton.ReleaseDeletedServerUUID(cleanupRPCUUID, 1, model.ServerOperationActor{}) })
	row, err := singleton.ConfigureDeletedCleanup(cleanupRPCUUID, 1, 0, true, model.ServerOperationActor{ID: 1})
	require.NoError(t, err)
	listener := bufconn.Listen(1024 * 1024)
	server := grpc.NewServer()
	pb.RegisterNezhaServiceServer(server, NewNezhaHandler())
	go func() { _ = server.Serve(listener) }()
	conn, err := grpc.NewClient("passthrough:///cleanup", grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) { return listener.Dial() }), grpc.WithTransportCredentials(insecure.NewCredentials()))
	require.NoError(t, err)
	t.Cleanup(func() { _ = conn.Close(); server.Stop(); _ = listener.Close() })
	return pb.NewNezhaServiceClient(conn), row
}
func cleanupOutgoing(ctx context.Context, secret string) context.Context {
	return metadata.NewOutgoingContext(ctx, metadata.Pairs("client-secret", secret, "client-uuid", cleanupRPCUUID))
}
func waitCleanupState(t *testing.T, state string) model.ServerDeletionTombstone {
	t.Helper()
	var row model.ServerDeletionTombstone
	require.Eventually(t, func() bool {
		return singleton.DB.First(&row, "uuid = ?", cleanupRPCUUID).Error == nil && row.CleanupState == state
	}, 3*time.Second, 10*time.Millisecond)
	return row
}

func TestDeletedCleanupWireFlowIsBoundedAndNeverRegisters(t *testing.T) {
	client, row := setupCleanupRPC(t)
	for _, secret := range []string{"", "invalid", "bob-global"} {
		ctx, cancel := context.WithTimeout(cleanupOutgoing(context.Background(), secret), time.Second)
		_, err := client.ReportSystemInfo2(ctx, &pb.Host{Platform: "ubuntu"})
		cancel()
		require.Error(t, err)
	}
	// Ordinary auth remains blocked even with a valid key while cleanup is enabled.
	_, err := authCheckWithHyphenatedSecret("alice-global", cleanupRPCUUID)
	require.Error(t, err)
	ctx, cancel := context.WithTimeout(cleanupOutgoing(context.Background(), "alice-global"), 4*time.Second)
	defer cancel()
	_, err = client.ReportSystemInfo2(ctx, &pb.Host{Platform: "ubuntu"})
	require.NoError(t, err)
	tasks, err := client.RequestTask(ctx)
	require.NoError(t, err)
	task, err := tasks.Recv()
	require.NoError(t, err)
	require.EqualValues(t, model.TaskTypeCommand, task.Type)
	require.Contains(t, task.Data, cleanupRPCUUID)
	require.Contains(t, task.Data, "NZ_UNINSTALL_STARTED")
	// Never execute the payload: simulate the standard Agent's acknowledgement.
	states, err := client.ReportSystemState(ctx)
	require.NoError(t, err)
	require.NoError(t, states.Send(&pb.State{Cpu: 99}))
	_, err = states.Recv()
	require.NoError(t, err)
	// A competing connection cannot dispatch again or cancel the winning attempt.
	duplicate, err := client.RequestTask(ctx)
	require.NoError(t, err)
	_, err = duplicate.Recv()
	require.Error(t, err)
	require.NoError(t, singleton.DB.First(row, "uuid = ?", row.UUID).Error)
	require.Equal(t, "sending", row.CleanupState)
	require.True(t, row.CleanupEnabled)
	require.NoError(t, tasks.Send(&pb.TaskResult{Id: task.Id, Type: task.Type, Successful: true, Data: "NZ_UNINSTALL_STARTED"}))
	saved := waitCleanupState(t, "retry_wait")
	require.True(t, saved.CleanupEnabled)
	require.Equal(t, "started", saved.CleanupLastResult)
	require.EqualValues(t, 1, saved.CleanupAttempts)
	require.True(t, singleton.IsDeletedServerUUID(cleanupRPCUUID))
	var count int64
	require.NoError(t, singleton.DB.Model(&model.Server{}).Where("uuid = ?", cleanupRPCUUID).Count(&count).Error)
	require.Zero(t, count)
	_, present := singleton.ServerShared.UUIDToID(cleanupRPCUUID)
	require.False(t, present)
	require.NoError(t, singleton.DB.Model(&model.Transfer{}).Where("server_id = ?", 12).Count(&count).Error)
	require.Zero(t, count)
	_, err = client.ReportSystemInfo2(ctx, &pb.Host{Platform: "ubuntu"})
	require.Error(t, err, "no early retry")
}

func TestDeletedCleanupWireFailureAndSpoofedReceipt(t *testing.T) {
	for _, kind := range []string{"disabled", "wrong receipt", "disconnect", "platform mismatch"} {
		t.Run(kind, func(t *testing.T) {
			client, _ := setupCleanupRPC(t)
			ctx, cancel := context.WithTimeout(cleanupOutgoing(context.Background(), "alice-global"), 3*time.Second)
			defer cancel()
			platform := "ubuntu"
			if kind == "platform mismatch" {
				platform = "windows"
			}
			_, err := client.ReportSystemInfo2(ctx, &pb.Host{Platform: platform})
			if kind == "platform mismatch" {
				require.Error(t, err)
				saved := waitCleanupState(t, "attention")
				require.Zero(t, saved.CleanupAttempts)
				return
			}
			require.NoError(t, err)
			tasks, err := client.RequestTask(ctx)
			require.NoError(t, err)
			task, err := tasks.Recv()
			require.NoError(t, err)
			expected := "failed"
			switch kind {
			case "disconnect":
				cancel()
				expected = "unknown"
			case "wrong receipt":
				require.NoError(t, tasks.Send(&pb.TaskResult{Id: task.Id + 1, Type: model.TaskTypeCommand, Successful: true, Data: "NZ_UNINSTALL_STARTED"}))
				expected = "unknown"
			default:
				require.NoError(t, tasks.Send(&pb.TaskResult{Id: task.Id, Type: model.TaskTypeCommand, Successful: false, Data: "sensitive untrusted output"}))
			}
			saved := waitCleanupState(t, "retry_wait")
			require.Equal(t, expected, saved.CleanupLastResult)
			require.NotContains(t, saved.CleanupMessage, "sensitive")
			require.True(t, saved.CleanupEnabled)
		})
	}
}

func TestDeletedCleanupClosedAndReleasedCannotDispatch(t *testing.T) {
	client, row := setupCleanupRPC(t)
	_, err := singleton.ConfigureDeletedCleanup(row.UUID, 1, row.CleanupRevision, false, model.ServerOperationActor{})
	require.NoError(t, err)
	ctx, cancel := context.WithTimeout(cleanupOutgoing(context.Background(), "alice-global"), time.Second)
	defer cancel()
	tasks, err := client.RequestTask(ctx)
	require.NoError(t, err)
	_, err = tasks.Recv()
	require.Error(t, err)
	var saved model.ServerDeletionTombstone
	require.NoError(t, singleton.DB.First(&saved, "uuid = ?", row.UUID).Error)
	require.Zero(t, saved.CleanupAttempts)
	require.Equal(t, "cancelled", saved.CleanupState)
}
func TestDeletedCleanupWireRetriesOnlyAfterMinuteAndWarns(t *testing.T) {
	client, row := setupCleanupRPC(t)
	ctx, cancel := context.WithTimeout(cleanupOutgoing(context.Background(), "alice-global"), 8*time.Second)
	defer cancel()
	for attempt := 1; attempt <= 3; attempt++ {
		_, err := client.ReportSystemInfo2(ctx, &pb.Host{Platform: "ubuntu"})
		require.NoError(t, err)
		tasks, err := client.RequestTask(ctx)
		require.NoError(t, err)
		task, err := tasks.Recv()
		require.NoError(t, err)
		require.Contains(t, task.Data, cleanupRPCUUID)
		// Fake receipt only. NEVER execute this destructive payload in tests.
		require.NoError(t, tasks.Send(&pb.TaskResult{Id: task.Id, Type: task.Type, Successful: true, Data: "NZ_UNINSTALL_STARTED"}))
		saved := waitCleanupState(t, "retry_wait")
		require.EqualValues(t, attempt, saved.CleanupRoundAttempts)
		require.GreaterOrEqual(t, saved.CleanupNextAttemptAt, time.Now().Unix()+59)
		_, err = client.ReportSystemInfo2(ctx, &pb.Host{Platform: "ubuntu"})
		require.Error(t, err, "cooldown blocks early handshake")
		early, err := client.RequestTask(ctx)
		require.NoError(t, err)
		_, err = early.Recv()
		require.Error(t, err, "direct task call cannot bypass cooldown")
		// Advance just the fixture due time; no wall-clock wait or real node.
		require.NoError(t, singleton.DB.Model(row).Update("cleanup_next_attempt_at", time.Now().Unix()-1).Error)
	}
	_, err := client.ReportSystemInfo2(ctx, &pb.Host{Platform: "ubuntu"})
	require.NoError(t, err)
	tasks, err := client.RequestTask(ctx)
	require.NoError(t, err)
	_, err = tasks.Recv()
	require.Error(t, err, "fourth command must not be sent")
	saved := waitCleanupState(t, "attention")
	require.False(t, saved.CleanupEnabled)
	require.EqualValues(t, 3, saved.CleanupRoundAttempts)
	require.True(t, singleton.IsDeletedServerUUID(cleanupRPCUUID))
	_, present := singleton.ServerShared.UUIDToID(cleanupRPCUUID)
	require.False(t, present)
}
