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
	result   chan *pb.TaskResult
}

// LaunchAgentUninstall uses the existing Command task, including the Agent's
// DisableCommandExecute gate. A reply only acknowledges an independent cleanup
// worker was started, never that the remote uninstallation has completed.
func LaunchAgentUninstall(ctx context.Context, server *model.Server, command string) error {
	if server == nil || server.GetTaskStream() == nil {
		return ErrAgentOffline
	}
	taskID := uninstallTaskMask | uninstallTaskCounter.Add(1)
	waiter := &uninstallCommandWaiter{serverID: server.ID, result: make(chan *pb.TaskResult, 1)}
	uninstallCommands.Store(taskID, waiter)
	defer uninstallCommands.Delete(taskID)
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	// A wedged gRPC Send must not hold the whole deletion request indefinitely.
	sent := make(chan error, 1)
	go func() { sent <- server.SendTask(&pb.Task{Id: taskID, Type: model.TaskTypeCommand, Data: command}) }()
	select {
	case err := <-sent:
		if err != nil {
			return err
		}
	case <-ctx.Done():
		return errors.New("卸载任务发送超时，远端清理结果未知")
	}
	select {
	case result := <-waiter.result:
		if result.GetSuccessful() && strings.TrimSpace(result.GetData()) == "NZ_UNINSTALL_STARTED" {
			return nil
		}
		return errors.New("Agent 未确认启动卸载任务（可能禁止命令执行、权限不足或不是标准安装）")
	case <-ctx.Done():
		return errors.New("卸载任务确认超时，远端清理结果未知")
	}
}

// Return true for all reserved results, including late/forged replies, so they
// never enter cron result processing. Reporter identity comes from authenticated
// RequestTask, not from the task payload.
func deliverUninstallCommandResult(result *pb.TaskResult, reporterID uint64) bool {
	if result == nil || result.GetType() != model.TaskTypeCommand || result.GetId()&uninstallTaskMask == 0 {
		return false
	}
	value, ok := uninstallCommands.Load(result.GetId())
	if !ok {
		return true
	}
	waiter := value.(*uninstallCommandWaiter)
	if reporterID == 0 || reporterID != waiter.serverID {
		return true
	}
	select {
	case waiter.result <- result:
	default:
	}
	return true
}
