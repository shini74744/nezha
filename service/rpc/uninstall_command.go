package rpc

import (
	"context"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/nezhahq/nezha/model"
	pb "github.com/nezhahq/nezha/proto"
)

const uninstallTaskMask uint64 = 1 << 63

var uninstallTaskCounter atomic.Uint64
var uninstallCommands sync.Map

type uninstallCommandWaiter struct {
	serverID uint64
	stream   pb.NezhaService_RequestTaskServer
	result   chan *pb.TaskResult
}

// PreparedUninstall has authority only over the connection captured BEFORE
// deletion. It cannot dial, authenticate, or attach a future connection.
type PreparedUninstall struct {
	serverID uint64
	stream   pb.NezhaService_RequestTaskServer
	send     func(context.Context, *pb.Task) error
}

func PrepareAgentUninstall(server *model.Server) *PreparedUninstall {
	if server == nil {
		return nil
	}
	stream, send := server.CaptureDeletionTaskSender()
	if send == nil {
		return nil
	}
	return &PreparedUninstall{serverID: server.ID, stream: stream, send: send}
}
func LaunchAgentUninstall(ctx context.Context, server *model.Server, command string) error {
	return PrepareAgentUninstall(server).Launch(ctx, command)
}
func (p *PreparedUninstall) Launch(ctx context.Context, command string) error {
	if p == nil {
		return ErrAgentOffline
	}
	taskID := uninstallTaskMask | uninstallTaskCounter.Add(1)
	waiter := &uninstallCommandWaiter{serverID: p.serverID, stream: p.stream, result: make(chan *pb.TaskResult, 1)}
	uninstallCommands.Store(taskID, waiter)
	defer uninstallCommands.Delete(taskID)
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	sent := make(chan error, 1)
	go func() { sent <- p.send(ctx, &pb.Task{Id: taskID, Type: model.TaskTypeCommand, Data: command}) }()
	select {
	case err := <-sent:
		if err != nil {
			return err
		}
	case <-ctx.Done():
		return errors.New("卸载命令发送超时，远端结果未知")
	}
	select {
	case result := <-waiter.result:
		if result.GetSuccessful() && strings.TrimSpace(result.GetData()) == "NZ_UNINSTALL_STARTED" {
			return nil
		}
		return errors.New("未能启动卸载，请在服务器上手动检查")
	case <-ctx.Done():
		return errors.New("卸载启动确认超时，请在服务器上手动检查")
	}
}

// This accepts ONLY a reserved reply from its original authenticated stream,
// even if deletion has revoked normal reporting. It never accepts monitoring,
// cron or registration data and can never authorize a reconnect.
func deliverUninstallCommandResult(result *pb.TaskResult, reporterID uint64, streams ...pb.NezhaService_RequestTaskServer) bool {
	if result == nil || result.GetType() != model.TaskTypeCommand || result.GetId()&uninstallTaskMask == 0 {
		return false
	}
	value, ok := uninstallCommands.Load(result.GetId())
	if !ok {
		return true
	}
	waiter := value.(*uninstallCommandWaiter)
	if reporterID == 0 || reporterID != waiter.serverID || len(streams) != 1 || streams[0] != waiter.stream {
		return true
	}
	select {
	case waiter.result <- result:
	default:
	}
	return true
}

// Only a live waiter grants the narrow post-deletion reply exception.
func matchesPendingUninstallResult(result *pb.TaskResult, reporterID uint64, stream pb.NezhaService_RequestTaskServer) bool {
	if result == nil || result.GetType() != model.TaskTypeCommand || result.GetId()&uninstallTaskMask == 0 {
		return false
	}
	value, ok := uninstallCommands.Load(result.GetId())
	if !ok {
		return false
	}
	waiter := value.(*uninstallCommandWaiter)
	return reporterID != 0 && reporterID == waiter.serverID && stream == waiter.stream
}
