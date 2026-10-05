package rpc

import (
	"context"
	"errors"
	"log"
	"strings"
	"time"

	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/agentuninstall"
	pb "github.com/nezhahq/nezha/proto"
	"github.com/nezhahq/nezha/service/singleton"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func deletedCleanupRequest(ctx context.Context) (*model.ServerDeletionTombstone, string, bool) {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return nil, "", false
	}
	secret := firstMetadataValue(md, "client-secret", "client_secret")
	value := firstMetadataValue(md, "client-uuid", "client_uuid")
	row, allowed := singleton.AuthorizeDeletedCleanup(value, secret)
	return row, secret, allowed
}

// Admission is isolated from auth.Check, normal server IDs, IO streams and metrics.
// ReportSystemInfo is the first call in existing Agents, before RequestTask.
func deletedCleanupHost(ctx context.Context, host *pb.Host) (bool, error) {
	row, _, ok := deletedCleanupRequest(ctx)
	if !ok {
		return false, nil
	}
	ip, _ := ctx.Value(model.CtxKeyRealIP{}).(string)
	singleton.RecordDeletedAgentReport(row.UUID, ip)
	if host == nil || !singleton.DeletedCleanupHostAllowed(row, host.GetPlatform()) {
		finishDeletedCleanup(row, "failed", "重连系统与删除记录不匹配或不支持标准卸载；未下发命令")
		return true, status.Error(codes.PermissionDenied, "cleanup platform mismatch")
	}
	return true, nil
}

func finishDeletedCleanup(row *model.ServerDeletionTombstone, state, message string) {
	if err := singleton.FinishDeletedCleanup(row, state, message); err != nil && !errors.Is(err, singleton.ErrDeletedCleanupChanged) {
		log.Printf("NEZHA>> persist deleted-agent cleanup result failed: %v", err)
	}
}

func runDeletedCleanupTask(stream pb.NezhaService_RequestTaskServer, row *model.ServerDeletionTombstone, secret string) error {
	command, err := agentuninstall.Command(row.UUID, row.CleanupPlatform)
	if err != nil {
		return status.Error(codes.PermissionDenied, "unsupported cleanup installation")
	}
	id := uninstallTaskMask | uninstallTaskCounter.Add(1)
	// A send is considered in flight as soon as dispatch begins. Cancellation
	// cannot recall bytes already handed to gRPC; the UI explicitly states this.
	attempted := false
	err = singleton.DispatchDeletedCleanup(row, secret, func() error {
		attempted = true
		sent := make(chan error, 1)
		go func() { sent <- stream.Send(&pb.Task{Id: id, Type: model.TaskTypeCommand, Data: command}) }()
		timer := time.NewTimer(3 * time.Second)
		defer timer.Stop()
		select {
		case err := <-sent:
			return err
		case <-stream.Context().Done():
			return stream.Context().Err()
		case <-timer.C:
			return context.DeadlineExceeded
		}
	})
	if err != nil {
		// CAS/audit failure must not mutate a different attempt or claim a send.
		if attempted {
			finishDeletedCleanup(row, "unknown", "任务未确认送达，结果未知；请检查后手动重试")
		}
		return err
	}
	// One receiver, one result, bound to this exact authenticated stream and task.
	type receipt struct {
		result *pb.TaskResult
		err    error
	}
	received := make(chan receipt, 1)
	go func() { r, e := stream.Recv(); received <- receipt{r, e} }()
	timer := time.NewTimer(12 * time.Second)
	defer timer.Stop()
	select {
	case got := <-received:
		if got.err != nil {
			finishDeletedCleanup(row, "unknown", "连接中断，未收到卸载启动确认；不代表卸载成功")
		} else if got.result.GetId() != id || got.result.GetType() != model.TaskTypeCommand {
			finishDeletedCleanup(row, "unknown", "收到不匹配的任务回执，清理结果未知")
		} else if got.result.GetSuccessful() && strings.TrimSpace(got.result.GetData()) == "NZ_UNINSTALL_STARTED" {
			finishDeletedCleanup(row, "started", "Agent 已确认启动独立清理任务；不是卸载完成回执")
		} else {
			finishDeletedCleanup(row, "failed", "Agent 未启动清理，可能禁止命令执行、权限不足或不是标准安装")
		}
	case <-timer.C:
		finishDeletedCleanup(row, "unknown", "等待启动回执超时，清理结果未知；不会自动重试")
	case <-stream.Context().Done():
		finishDeletedCleanup(row, "unknown", "连接中断，未收到卸载启动确认；不代表卸载成功")
	}
	return nil
}

// Keep the existing Agent's state worker alive briefly while its task worker
// receives the cleanup. Discard ALL metrics; do not create inventory/TSDB data.
func drainDeletedCleanupState(stream pb.NezhaService_ReportSystemStateServer, row *model.ServerDeletionTombstone, secret string) error {
	states := make(chan *pb.State)
	ended := make(chan struct{})
	defer close(ended)
	go func() {
		defer close(states)
		for {
			state, err := stream.Recv()
			if err != nil {
				return
			}
			select {
			case states <- state:
			case <-ended:
				return
			}
		}
	}()
	deadline := time.NewTimer(20 * time.Second)
	defer deadline.Stop()
	for {
		select {
		case _, ok := <-states:
			if !ok {
				return nil
			}
			current, allowed := singleton.AuthorizeDeletedCleanup(row.UUID, secret)
			if !allowed || current.BlockVersion != row.BlockVersion || current.CleanupRevision != row.CleanupRevision {
				return status.Error(codes.PermissionDenied, "cleanup session ended")
			}
			if err := stream.Send(&pb.Receipt{Proced: true}); err != nil {
				return err
			}
		case <-stream.Context().Done():
			return stream.Context().Err()
		case <-deadline.C:
			return status.Error(codes.DeadlineExceeded, "cleanup session expired")
		}
	}
}
