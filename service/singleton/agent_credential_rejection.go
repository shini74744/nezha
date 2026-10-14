package singleton

import (
	"context"
	"errors"
	guuid "github.com/hashicorp/go-uuid"
	"github.com/nezhahq/nezha/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"net"
	"time"
)

func RecordRejectedAgentCredential(value, secret, ip string) {
	if !AgentCredentialsReady() || DB == nil || len(value) > 128 || len(secret) > 4096 {
		return
	}
	hash := AgentCredentialHash(secret)
	id := AgentCredentialHash(value + "\x00" + hash)
	var sealed []byte
	valid := true
	if _, err := guuid.ParseUUID(value); err != nil {
		valid = false
		value = ""
	}
	if valid && len(secret) >= 16 && len(secret) <= 128 {
		sealed, _ = SealAgentSecret(secret)
	}
	address := ""
	if parsed := net.ParseIP(ip); parsed != nil {
		address = parsed.String()
	}
	now := time.Now().Unix()
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	db := credentialDB().WithContext(ctx)
	result := db.Model(&model.AgentCredentialRejection{}).Where("id = ?", id).
		Updates(map[string]any{"last_ip": address, "last_report_at": now, "report_count": gorm.Expr("report_count + 1"), "accepted_at": 0})
	if result.Error != nil || result.RowsAffected > 0 {
		return
	}
	// Peer-controlled cardinality is bounded. Never retain plaintext secrets.
	db.Exec(`INSERT INTO agent_credential_rejections
 (id,uuid,secret_hash,secret_sealed,fingerprint,last_ip,first_report_at,last_report_at,report_count,accepted_at)
 SELECT ?,?,?,?,?,?,?,?,1,0 WHERE (SELECT COUNT(*) FROM agent_credential_rejections) < 10000
 ON CONFLICT(id) DO UPDATE SET last_ip=excluded.last_ip,last_report_at=excluded.last_report_at,report_count=report_count+1,accepted_at=0`,
		id, value, hash, sealed, hash[:12], address, now, now)
}

type AgentCredentialAdmission struct {
	ReportID       string `json:"report_id" binding:"required"`
	BindingVersion uint64 `json:"binding_version"`
	BlockVersion   uint64 `json:"block_version"`
}

func AdmitAgentCredential(request AgentCredentialAdmission, actor model.ServerOperationActor) (*model.Server, error) {
	if !AgentCredentialsReady() {
		return nil, errors.New("认证信息尚未就绪")
	}
	ServerMutationMu.Lock()
	defer ServerMutationMu.Unlock()
	if ServerIDReassignmentInProgress.Load() {
		return nil, errors.New("服务器 ID 正在调整")
	}
	var report model.AgentCredentialRejection
	if err := credentialDB().First(&report, "id = ?", request.ReportID).Error; err != nil {
		return nil, errors.New("认证记录不存在")
	}
	if _, err := guuid.ParseUUID(report.UUID); err != nil {
		return nil, errors.New("UUID 不合法，不能放行")
	}
	secret, err := OpenAgentSecret(report.SecretSealed)
	if err != nil {
		return nil, errors.New("密钥格式不完整，不能放行")
	}
	if AgentCredentialHash(secret) != report.SecretHash {
		return nil, errors.New("认证记录不完整")
	}
	UserLock.RLock()
	_, shared := AgentSecretToUserId[secret]
	UserLock.RUnlock()
	if shared {
		return nil, errors.New("旧共享密钥不能作为独立密钥放行，请使用专属安装命令")
	}
	var replacing int64
	if err := DB.Model(&model.ServerReplacement{}).Where("server_uuid = ? AND state IN ?", report.UUID, []string{"pending", "clearing"}).Count(&replacing).Error; err != nil {
		return nil, err
	}
	if replacing > 0 || ServerReplacementClearing(report.UUID) {
		return nil, errors.New("请先完成或取消服务器换机")
	}
	if other, ok := AgentCredentialBySecret(secret); ok && other.UUID != report.UUID {
		return nil, errors.New("密钥已绑定其他 UUID，不能重复放行")
	}
	previous, exists := AgentCredentialByUUID(report.UUID)
	if (exists && previous.Version != request.BindingVersion) || (!exists && request.BindingVersion != 0) {
		return nil, errors.New("认证配对已变化，请刷新后重新确认")
	}
	var tombstone model.ServerDeletionTombstone
	err = DB.First(&tombstone, "uuid = ?", report.UUID).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if tombstone.UUID != "" && tombstone.BlockVersion != request.BlockVersion {
		return nil, errors.New("封禁记录已变化，请刷新后重新确认")
	}
	if tombstone.UUID == "" && request.BlockVersion != 0 {
		return nil, errors.New("封禁记录已变化")
	}
	server := &model.Server{}
	found := DB.Where("uuid = ?", report.UUID).First(server).Error
	if found != nil && !errors.Is(found, gorm.ErrRecordNotFound) {
		return nil, found
	}
	owner := actor.ID
	if found == nil {
		owner = server.GetUserID()
		if ServerTransferShared != nil {
			if ServerTransferShared.credentialTransitionPending(server.ID) {
				return nil, errors.New("请先完成服务器转移或认证恢复")
			}
		}
	}
	if owner == 0 && found != nil {
		return nil, errors.New("请先选择有效的所属账号")
	}
	now := time.Now().Unix()
	version := uint64(1)
	if exists {
		version = previous.Version + 1
	}
	row := model.AgentCredential{UUID: report.UUID, OwnerID: owner, SecretHash: report.SecretHash, SecretSealed: report.SecretSealed, Version: version, VerifiedAt: now, CreatedAt: time.Now()}
	err = credentialDB().Transaction(func(tx *gorm.DB) error {
		if found != nil {
			created, err := createServerWithLowestAvailableIDInTx(tx, owner, report.UUID, "手动放行节点")
			if err != nil {
				return err
			}
			server = created
		}
		if err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "uuid"}}, UpdateAll: true}).Create(&row).Error; err != nil {
			return errors.New("密钥已被绑定或认证信息保存失败")
		}
		if tombstone.UUID != "" && tombstone.ReleasedAt == 0 {
			result := tx.Model(&model.ServerDeletionTombstone{}).Where("uuid = ? AND block_version = ? AND released_at = 0", report.UUID, request.BlockVersion).
				Updates(map[string]any{"released_at": now, "released_by_id": actor.ID, "released_by_name": actor.Name, "cleanup_enabled": false, "cleanup_revision": gorm.Expr("cleanup_revision + 1"), "cleanup_next_attempt_at": 0, "cleanup_credential_hash": ""})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return errors.New("封禁状态已变化")
			}
		}
		if err := tx.Model(&model.AgentCredentialRejection{}).Where("id = ?", report.ID).Update("accepted_at", now).Error; err != nil {
			return err
		}
		before := "未登记认证"
		if exists {
			before = "密钥指纹 " + previous.SecretHash[:12]
		}
		return model.RecordServerOperationChanges(tx, actor, "admit_credential", server, server.ID, []model.ServerOperationChange{{Field: "agent_credential", Before: before, After: "已放行配对 · " + report.Fingerprint}})
	})
	if err != nil {
		return nil, err
	}
	if old, ok := ServerShared.Get(server.ID); ok && old != nil {
		old.RevokeStreams()
	} else {
		model.InitServer(server)
		ServerShared.Update(server, server.UUID)
	}
	publishAgentCredential(row)
	unblockDeletedServerUUIDs([]string{report.UUID})
	return server, nil
}
