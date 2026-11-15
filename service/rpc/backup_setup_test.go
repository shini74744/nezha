package rpc

import (
	"context"
	"github.com/nezhahq/nezha/model"
	pb "github.com/nezhahq/nezha/proto"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func TestBackupSetupBoundToServerAndSession(t *testing.T) {
	stream := newFakeStream()
	server := &model.Server{Common: model.Common{ID: 19}}
	server.SetTaskStream(stream)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	result := make(chan error, 1)
	go func() { _, e := SetupBackupTarget(ctx, server, "fixture-only"); result <- e }()
	task := <-stream.sent
	reply := &pb.TaskResult{Id: task.Id, Type: model.TaskTypeCommand, Successful: true, Data: "DDNEZHA_BACKUP_HOSTKEY=SHA256:fixture\nDDNEZHA_BACKUP_READY"}
	require.True(t, deliverBackupSetupResult(reply, 99, stream))
	require.True(t, deliverBackupSetupResult(reply, 19, newFakeStream()))
	select {
	case e := <-result:
		t.Fatalf("foreign reply accepted %v", e)
	default:
	}
	require.True(t, deliverBackupSetupResult(reply, 19, stream))
	require.NoError(t, <-result)
	require.True(t, deliverBackupSetupResult(reply, 19, stream))
	backupSetupWaiters.Range(func(_, _ any) bool { t.Error("waiter leaked"); return true })
}
func TestBackupSetupDisabledOfflineAndTimeout(t *testing.T) {
	_, e := SetupBackupTarget(context.Background(), nil, "fixture")
	require.Error(t, e)
	stream := newFakeStream()
	server := &model.Server{Common: model.Common{ID: 19}}
	server.SetTaskStream(stream)
	result := make(chan error, 1)
	go func() { _, e := SetupBackupTarget(context.Background(), server, "fixture"); result <- e }()
	task := <-stream.sent
	deliverBackupSetupResult(&pb.TaskResult{Id: task.Id, Type: model.TaskTypeCommand, Successful: false, Data: "command execution is disabled"}, 19, stream)
	require.ErrorContains(t, <-result, "Agent 已关闭")
	ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond*10)
	defer cancel()
	_, e = SetupBackupTarget(ctx, server, "fixture")
	require.ErrorContains(t, e, "超时")
}
