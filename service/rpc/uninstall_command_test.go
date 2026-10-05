package rpc

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/nezhahq/nezha/model"
	pb "github.com/nezhahq/nezha/proto"
	"github.com/stretchr/testify/require"
)

func TestUninstallCommandAcknowledgementBoundToReporter(t *testing.T) {
	stream := newFakeStream()
	server := &model.Server{Common: model.Common{ID: 42}}
	server.SetTaskStream(stream)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- LaunchAgentUninstall(ctx, server, "fixture-only") }()
	task := <-stream.sent
	require.EqualValues(t, model.TaskTypeCommand, task.Type)
	require.NotZero(t, task.Id&uninstallTaskMask)
	res := &pb.TaskResult{Id: task.Id, Type: task.Type, Successful: true, Data: "NZ_UNINSTALL_STARTED"}
	require.True(t, deliverUninstallCommandResult(res, 99))
	select {
	case err := <-done:
		t.Fatalf("foreign reply accepted: %v", err)
	default:
	}
	require.True(t, deliverUninstallCommandResult(res, 42))
	require.NoError(t, <-done)
	require.True(t, deliverUninstallCommandResult(res, 42), "late result must not reach cron")
}
func TestUninstallCommandFailureDoesNotClaimStarted(t *testing.T) {
	for _, result := range []*pb.TaskResult{
		{Successful: false, Data: "NZ_UNINSTALL_STARTED"},
		{Successful: true, Data: "something else"},
		{Successful: true, Data: "echo NZ_UNINSTALL_STARTED failed"},
	} {
		stream := newFakeStream()
		server := &model.Server{Common: model.Common{ID: 42}}
		server.SetTaskStream(stream)
		done := make(chan error, 1)
		go func() { done <- LaunchAgentUninstall(context.Background(), server, "fixture") }()
		task := <-stream.sent
		result.Id, result.Type = task.Id, task.Type
		deliverUninstallCommandResult(result, 42)
		require.Error(t, <-done)
	}
}
func TestUninstallCommandOfflineTimeoutAndSendFailure(t *testing.T) {
	require.ErrorIs(t, LaunchAgentUninstall(context.Background(), nil, ""), ErrAgentOffline)
	server := &model.Server{Common: model.Common{ID: 42}}
	server.SetTaskStream(&fakeTaskStream{err: errors.New("send failed")})
	require.EqualError(t, LaunchAgentUninstall(context.Background(), server, "fixture"), "send failed")
	stream := newFakeStream()
	server.SetTaskStream(stream)
	ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()
	require.ErrorContains(t, LaunchAgentUninstall(ctx, server, "fixture"), "超时")
	uninstallCommands.Range(func(key, value any) bool { t.Error("pending uninstall waiter leaked"); return true })
	require.False(t, deliverUninstallCommandResult(&pb.TaskResult{Id: 8, Type: model.TaskTypeCommand}, 42))
}

type stalledUninstallStream struct {
	pb.NezhaService_RequestTaskServer
	release  chan struct{}
	finished chan struct{}
}

func (s *stalledUninstallStream) Send(*pb.Task) error {
	<-s.release
	close(s.finished)
	return nil
}
func TestUninstallCommandSendTimeout(t *testing.T) {
	stream := &stalledUninstallStream{release: make(chan struct{}), finished: make(chan struct{})}
	server := &model.Server{Common: model.Common{ID: 43}}
	server.SetTaskStream(stream)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	require.ErrorContains(t, LaunchAgentUninstall(ctx, server, "fixture"), "发送超时")
	close(stream.release)
	<-stream.finished
}
