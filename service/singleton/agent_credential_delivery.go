package singleton

import (
	"context"
	"errors"
	"github.com/nezhahq/nezha/model"
	pb "github.com/nezhahq/nezha/proto"
)

// Serialize secret delivery with transfer initiation and transfer/revert pushes.
// Any transfer beginning later must send after this task (Agent uses last-wins).
func DeliverAgentCredential(ctx context.Context, serverID uint64, value string, version uint64, stream pb.NezhaService_RequestTaskServer, task *pb.Task) error {
	if ServerTransferShared != nil {
		lock := ServerTransferShared.applyConfigSendLock(serverID)
		lock.Lock()
		defer lock.Unlock()
		if _, pending := ServerTransferShared.LookupPending(serverID); pending {
			return errors.New("服务器转移中")
		}
		if _, recovering := ServerTransferShared.LookupRevertDelivery(serverID); recovering {
			return errors.New("正在恢复转移认证")
		}
	}
	row, ok := AgentCredentialByUUID(value)
	if !ok || row.Version != version || row.VerifiedAt != 0 || !row.MigrationRequested || IsDeletedServerUUID(value) || ServerReplacementClearing(value) || ServerIDReassignmentInProgress.Load() {
		return errors.New("认证状态已变化")
	}
	server, ok := ServerShared.Get(serverID)
	if !ok || server.UUID != value || server.GetUserID() != row.OwnerID {
		return errors.New("服务器已变化")
	}
	var replacing int64
	if err := DB.Model(&model.ServerReplacement{}).Where("server_uuid = ? AND state IN ?", value, []string{"pending", "clearing"}).Count(&replacing).Error; err != nil {
		return err
	}
	if replacing > 0 {
		return errors.New("服务器换机中")
	}
	return server.SendTaskOnStream(ctx, task, stream)
}

// credentialTransitionPending also protects manual admission from an in-flight
// rollback overwriting the pair that the operator is about to approve.
func (c *ServerTransferClass) credentialTransitionPending(serverID uint64) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.pending[serverID] != nil || c.initiating[serverID] ||
		c.terminalSecretRecovery[serverID] != nil || c.revertDeliveries[serverID] != nil
}
