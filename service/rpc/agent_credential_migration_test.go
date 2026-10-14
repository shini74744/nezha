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

func TestAgentCredentialMigrationAckAloneNeverCompletes(t *testing.T) {
	for _, accepted := range []bool{false, true} {
		t.Run(map[bool]string{true: "ack-without-reconnect", false: "agent-rejects"}[accepted], func(t *testing.T) {
			enableCredentialAuthFixture(t)
			db, err := singleton.DB.DB()
			require.NoError(t, err)
			db.SetMaxOpenConns(1)
			pair, err := singleton.IssueAgentCredential(authHandshakeUUID, 100, model.ServerOperationActor{ID: 100})
			require.NoError(t, err)
			require.NoError(t, singleton.RequestAgentCredentialMigration(pair.UUID, pair.Version))
			stream := newFakeStream()
			server, ok := singleton.ServerShared.Get(11)
			require.True(t, ok)
			server.SetTaskStream(stream)
			binding, ok := singleton.AgentCredentialByUUID(pair.UUID)
			require.True(t, ok)
			ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
			defer cancel()
			done := make(chan struct{})
			go func() { defer close(done); migrateAgentCredential(ctx, binding) }()
			var task *pb.Task
			select {
			case task = <-stream.sent:
			case <-time.After(time.Second):
				t.Fatal("migration was not sent")
			}
			require.EqualValues(t, model.TaskTypeReportConfig, task.Type)
			deliverCredentialConfigProbe(&pb.TaskResult{Id: task.Id, Type: task.Type, Successful: true, Data: `{"tls":true,"insecure_tls":false}`}, 11, stream)
			select {
			case task = <-stream.sent:
			case <-time.After(time.Second):
				t.Fatal("migration not sent after secure probe")
			}
			require.EqualValues(t, model.TaskTypeServerTransferApply, task.Type)
			reply := &pb.TaskResult{Id: task.Id, Type: task.Type, Successful: accepted}
			value, exists := credentialMigrationReplies.Load(task.Id)
			require.True(t, exists)
			deliverCredentialMigrationResult(reply, 12, stream)
			require.Empty(t, value.(*credentialMigrationWaiter).reply, "foreign server cannot acknowledge migration")
			deliverCredentialMigrationResult(reply, 11, newFakeStream())
			require.Empty(t, value.(*credentialMigrationWaiter).reply, "another connection cannot acknowledge migration")
			deliverCredentialMigrationResult(reply, 11, stream)
			<-done
			binding, ok = singleton.AgentCredentialByUUID(pair.UUID)
			require.True(t, ok)
			require.Zero(t, binding.VerifiedAt)
			require.True(t, binding.MigrationRequested)
			_, err = authCheckWithSecret("alice-global", pair.UUID)
			require.NoError(t, err, "keep old authentication until new-key reconnect")
			credentialMigrationReplies.Range(func(_, _ any) bool { t.Error("migration waiter leaked"); return true })
		})
	}
}
func TestAgentCredentialMigrationOfflineAndReplacementAreDeferred(t *testing.T) {
	enableCredentialAuthFixture(t)
	pair, err := singleton.IssueAgentCredential(authHandshakeUUID, 100, model.ServerOperationActor{ID: 100})
	require.NoError(t, err)
	require.NoError(t, singleton.RequestAgentCredentialMigration(pair.UUID, pair.Version))
	row, _ := singleton.AgentCredentialByUUID(pair.UUID)
	migrateAgentCredential(context.Background(), row)
	row, _ = singleton.AgentCredentialByUUID(pair.UUID)
	require.Contains(t, row.LastError, "离线")
	require.Zero(t, row.VerifiedAt)
	server, _ := singleton.ServerShared.Get(11)
	stream := newFakeStream()
	server.SetTaskStream(stream)
	_, _, err = singleton.IssueServerReplacement(pair.UUID, model.ServerOperationActor{ID: 100})
	require.NoError(t, err)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	require.Error(t, singleton.DeliverAgentCredential(ctx, 11, pair.UUID, pair.Version, stream, &pb.Task{Type: model.TaskTypeServerTransferApply, Data: "fixture"}))
	require.Empty(t, stream.sent, "a pending replacement must not receive a migration overwrite")
}

func TestAgentCredentialMigrationNeverSendsNewKeyOnUnsafeConfig(t *testing.T) {
	for _, config := range []string{`{"tls":false}`, `{"tls":true,"insecure_tls":true}`, "invalid"} {
		t.Run(config, func(t *testing.T) {
			enableCredentialAuthFixture(t)
			pair, err := singleton.IssueAgentCredential(authHandshakeUUID, 100, model.ServerOperationActor{ID: 100})
			require.NoError(t, err)
			require.NoError(t, singleton.RequestAgentCredentialMigration(pair.UUID, pair.Version))
			row, _ := singleton.AgentCredentialByUUID(pair.UUID)
			server, _ := singleton.ServerShared.Get(11)
			stream := newFakeStream()
			server.SetTaskStream(stream)
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			done := make(chan struct{})
			go func() { defer close(done); migrateAgentCredential(ctx, row) }()
			probe := <-stream.sent
			require.EqualValues(t, model.TaskTypeReportConfig, probe.Type)
			reply := &pb.TaskResult{Id: probe.Id, Type: probe.Type, Successful: true, Data: config}
			deliverCredentialConfigProbe(reply, 12, stream)
			deliverCredentialConfigProbe(reply, 11, newFakeStream())
			value, _ := credentialMigrationReplies.Load(probe.Id)
			require.Empty(t, value.(*credentialMigrationWaiter).secureConfig)
			deliverCredentialConfigProbe(reply, 11, stream)
			<-done
			require.Empty(t, stream.sent, "new key must never be sent before trusted TLS config is confirmed")
			binding, _ := singleton.AgentCredentialByUUID(pair.UUID)
			require.Zero(t, binding.VerifiedAt)
			require.Contains(t, binding.LastError, "未下发新密钥")
			_, err = authCheckWithSecret("alice-global", pair.UUID)
			require.NoError(t, err)
		})
	}
}
