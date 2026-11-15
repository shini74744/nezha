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

const backupSetupTaskMask uint64 = 1 << 57

var backupSetupCounter atomic.Uint64
var backupSetupWaiters sync.Map

type backupSetupWaiter struct {
	serverID uint64
	stream   pb.NezhaService_RequestTaskServer
	result   chan *pb.TaskResult
}

func SetupBackupTarget(ctx context.Context, server *model.Server, command string) (string, error) {
	if server == nil || server.GetTaskStream() == nil {
		return "", ErrAgentOffline
	}
	return SetupBackupTargetOnStream(ctx, server, server.GetTaskStream(), command)
}
func SetupBackupTargetOnStream(ctx context.Context, server *model.Server, stream pb.NezhaService_RequestTaskServer, command string) (string, error) {
	if server == nil || stream == nil {
		return "", errors.New("Agent 当前离线，无法自动安装，请等待上线或使用手动安装命令")
	}

	id := backupSetupTaskMask | backupSetupCounter.Add(1)
	waiter := &backupSetupWaiter{server.ID, stream, make(chan *pb.TaskResult, 1)}
	backupSetupWaiters.Store(id, waiter)
	defer backupSetupWaiters.Delete(id)
	ctx, cancel := context.WithTimeout(ctx, 6*time.Minute)
	defer cancel()
	if err := server.SendTaskOnStream(ctx, &pb.Task{Id: id, Type: model.TaskTypeCommand, Data: command}, stream); err != nil {
		return "", err
	}
	select {
	case <-ctx.Done():
		return "", errors.New("对接等待超时，远端结果尚未确认；可重新测试连接或重试对接")
	case result := <-waiter.result:
		if !result.Successful || !strings.Contains(result.Data, "DDNEZHA_BACKUP_READY") {
			message := result.Data
			if strings.Contains(strings.ToLower(message), "disabled") || strings.Contains(message, "禁止") || strings.Contains(message, "关闭") {
				return "", errors.New("Agent 已关闭远程命令或在线终端，无法自动安装。请允许该机器执行命令，或复制专属命令到机器上手动安装")
			}
			if len(message) > 1600 {
				message = message[len(message)-1600:]
			}
			return "", errors.New("备份对接失败: " + message)
		}
		return result.Data, nil
	}
}
func deliverBackupSetupResult(result *pb.TaskResult, serverID uint64, stream pb.NezhaService_RequestTaskServer) bool {
	if result == nil || result.Type != model.TaskTypeCommand || result.Id&backupSetupTaskMask == 0 {
		return false
	}
	value, ok := backupSetupWaiters.Load(result.Id)
	if !ok {
		return true
	}
	waiter := value.(*backupSetupWaiter)
	if waiter.serverID != serverID || waiter.stream != stream {
		return true
	}
	select {
	case waiter.result <- result:
	default:
	}
	return true
}
