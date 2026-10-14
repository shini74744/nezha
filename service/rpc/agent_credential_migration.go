package rpc

import (
	"context"
	"encoding/json"
	"github.com/nezhahq/nezha/model"
	pb "github.com/nezhahq/nezha/proto"
	"github.com/nezhahq/nezha/service/singleton"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

const credentialMigrationTaskMask uint64 = 1 << 62

var credentialMigrationCounter atomic.Uint64
var credentialMigrationReplies sync.Map

type credentialMigrationWaiter struct {
	serverID     uint64
	stream       pb.NezhaService_RequestTaskServer
	reply        chan bool
	secureConfig chan bool
}

func deliverCredentialMigrationResult(result *pb.TaskResult, serverID uint64, stream pb.NezhaService_RequestTaskServer) bool {
	if result == nil || result.GetType() != model.TaskTypeServerTransferApply || result.GetId()&credentialMigrationTaskMask == 0 {
		return false
	}
	if value, ok := credentialMigrationReplies.Load(result.GetId()); ok {
		waiter := value.(*credentialMigrationWaiter)
		if waiter.serverID == serverID && waiter.stream == stream {
			select {
			case waiter.reply <- result.GetSuccessful():
			default:
			}
		}
	}
	return true
}

// Probe the currently authenticated connection before releasing a new secret.
// A proxy can terminate TLS, so checking the dashboard-side socket alone is not
// sufficient. Require the Agent's current, certificate-verified TLS config.
func deliverCredentialConfigProbe(result *pb.TaskResult, serverID uint64, stream pb.NezhaService_RequestTaskServer) bool {
	if result == nil || result.GetType() != model.TaskTypeReportConfig || result.GetId()&credentialMigrationTaskMask == 0 {
		return false
	}
	if value, ok := credentialMigrationReplies.Load(result.GetId()); ok {
		waiter := value.(*credentialMigrationWaiter)
		if waiter.serverID == serverID && waiter.stream == stream {
			var config struct {
				TLS         bool `json:"tls"`
				InsecureTLS bool `json:"insecure_tls"`
			}
			secure := result.GetSuccessful() && len(result.GetData()) < 1<<20 &&
				json.Unmarshal([]byte(result.GetData()), &config) == nil && config.TLS && !config.InsecureTLS
			select {
			case waiter.secureConfig <- secure:
			default:
			}
		}
	}
	return true
}

// One node at a time, with a bounded wait for authentication under the new
// key. Acknowledging a config push is NOT proof that migration completed.
func RunAgentCredentialMigrations(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		rows := singleton.PendingAgentCredentials()
		sort.Slice(rows, func(i, j int) bool { return rows[i].LastAttemptAt < rows[j].LastAttemptAt })
		for _, row := range rows {
			if ctx.Err() != nil {
				return
			}
			if time.Now().Unix()-row.LastAttemptAt < 300 {
				continue
			}
			migrateAgentCredential(ctx, row)
		}
	}
}
func migrateAgentCredential(parent context.Context, row model.AgentCredential) {
	if singleton.IsDeletedServerUUID(row.UUID) || singleton.ServerIDReassignmentInProgress.Load() {
		return
	}
	id, ok := singleton.ServerShared.UUIDToID(row.UUID)
	if !ok {
		return
	}
	server, ok := singleton.ServerShared.Get(id)
	if !ok || server == nil {
		return
	}
	stream := server.GetTaskStream()
	if stream == nil {
		_ = singleton.AgentCredentialMigrationStatus(row.UUID, row.Version, "节点离线，等待上线迁移")
		return
	}
	if singleton.ServerTransferShared != nil {
		if _, pending := singleton.ServerTransferShared.LookupPending(id); pending {
			return
		}
		if _, recovering := singleton.ServerTransferShared.LookupRevertDelivery(id); recovering {
			return
		}
	}
	if singleton.ServerReplacementClearing(row.UUID) {
		return
	}
	current, ok := singleton.AgentCredentialByUUID(row.UUID)
	if !ok || current.Version != row.Version || current.VerifiedAt != 0 || !current.MigrationRequested {
		return
	}
	secret, err := singleton.OpenAgentSecret(row.SecretSealed)
	if err != nil {
		_ = singleton.AgentCredentialMigrationStatus(row.UUID, row.Version, "认证信息读取失败，请检查面板备份")
		return
	}
	payload, _ := json.Marshal(map[string]string{"client_secret": secret})
	taskID := credentialMigrationTaskMask | credentialMigrationCounter.Add(1)
	waiter := &credentialMigrationWaiter{serverID: id, stream: stream, reply: make(chan bool, 1), secureConfig: make(chan bool, 1)}
	credentialMigrationReplies.Store(taskID, waiter)
	defer credentialMigrationReplies.Delete(taskID)
	ctx, cancel := context.WithTimeout(parent, 45*time.Second)
	defer cancel()
	_ = singleton.AgentCredentialMigrationStatus(row.UUID, row.Version, "正在检查安全连接")
	probeCtx, probeCancel := context.WithTimeout(ctx, 10*time.Second)
	defer probeCancel()
	if err := server.SendTaskOnStream(probeCtx, &pb.Task{Id: taskID, Type: model.TaskTypeReportConfig}, stream); err != nil {
		_ = singleton.AgentCredentialMigrationStatus(row.UUID, row.Version, "连接中断，未下发新密钥")
		return
	}
	select {
	case secure := <-waiter.secureConfig:
		if !secure {
			_ = singleton.AgentCredentialMigrationStatus(row.UUID, row.Version, "未确认安全 TLS 配置，未下发新密钥")
			return
		}
	case <-probeCtx.Done():
		_ = singleton.AgentCredentialMigrationStatus(row.UUID, row.Version, "未获取连接配置，未下发新密钥")
		return
	}
	_ = singleton.AgentCredentialMigrationStatus(row.UUID, row.Version, "正在下发独立密钥")
	sent := make(chan error, 1)
	go func() {
		sent <- singleton.DeliverAgentCredential(ctx, id, row.UUID, row.Version, stream, &pb.Task{Id: taskID, Type: model.TaskTypeServerTransferApply, Data: string(payload)})
	}()
	select {
	case err := <-sent:
		if err != nil {
			_ = singleton.AgentCredentialMigrationStatus(row.UUID, row.Version, "连接中断，稍后重试")
			return
		}
	case <-ctx.Done():
		_ = singleton.AgentCredentialMigrationStatus(row.UUID, row.Version, "下发超时，等待重新连接")
		return
	}
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		select {
		case accepted := <-waiter.reply:
			if !accepted {
				_ = singleton.AgentCredentialMigrationStatus(row.UUID, row.Version, "Agent 未接受更新，请检查版本、TLS 和命令权限")
				return
			}
		case <-tick.C:
			next, exists := singleton.AgentCredentialByUUID(row.UUID)
			if !exists || next.Version != row.Version || next.VerifiedAt > 0 {
				return
			}
		case <-ctx.Done():
			_ = singleton.AgentCredentialMigrationStatus(row.UUID, row.Version, "尚未确认新密钥连接，旧认证暂时保留")
			return
		}
	}
}
