package singleton

import (
	"errors"
	"fmt"
	guuid "github.com/hashicorp/go-uuid"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/utils"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
	"time"
)

type AgentCredentialPair struct {
	UUID    string `json:"uuid"`
	Secret  string `json:"client_secret"`
	Version uint64 `json:"version"`
}

func IssueAgentCredential(value string, ownerID uint64, actor model.ServerOperationActor) (*AgentCredentialPair, error) {
	if !AgentCredentialsReady() {
		return nil, errors.New("认证信息尚未就绪")
	}
	ServerMutationMu.Lock()
	defer ServerMutationMu.Unlock()
	if ServerIDReassignmentInProgress.Load() {
		return nil, errors.New("服务器 ID 正在调整")
	}
	isNew := value == ""
	if isNew {
		var err error
		value, err = guuid.GenerateUUID()
		if err != nil {
			return nil, err
		}
	} else {
		if _, err := guuid.ParseUUID(value); err != nil {
			return nil, errors.New("UUID 无效")
		}
		var server model.Server
		if err := DB.Where("uuid = ?", value).First(&server).Error; err != nil {
			return nil, err
		}
		if server.GetUserID() != ownerID {
			return nil, errors.New("服务器归属已变化")
		}
		if ServerTransferShared != nil {
			if _, ok := ServerTransferShared.LookupPending(server.ID); ok {
				return nil, errors.New("请先完成服务器转移")
			}
		}
	}
	if IsDeletedServerUUID(value) {
		return nil, errors.New("认证信息已封禁，请先整组放行")
	}
	if row, ok := AgentCredentialByUUID(value); ok {
		if row.OwnerID != ownerID {
			return nil, errors.New("认证信息归属已变化")
		}
		secret, err := OpenAgentSecret(row.SecretSealed)
		if err != nil {
			return nil, err
		}
		return &AgentCredentialPair{UUID: value, Secret: secret, Version: row.Version}, nil
	}
	var unused int64
	if err := credentialDB().Model(&model.AgentCredential{}).Where("owner_id = ? AND verified_at = 0", ownerID).
		Where("NOT EXISTS (SELECT 1 FROM servers s WHERE s.uuid=agent_credentials.uuid)").Count(&unused).Error; err != nil {
		return nil, err
	}
	if isNew && unused >= 1000 {
		return nil, errors.New("未使用认证已达上限，请先在生成认证历史中清理或复用")
	}
	secret, err := utils.GenerateRandomString(32)
	if err != nil {
		return nil, err
	}
	sealed, err := SealAgentSecret(secret)
	if err != nil {
		return nil, err
	}
	row := model.AgentCredential{UUID: value, OwnerID: ownerID, SecretHash: AgentCredentialHash(secret), SecretSealed: sealed, Version: 1}
	if err := credentialDB().Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&row).Error; err != nil {
			return errors.New("生成认证信息失败")
		}
		var server model.Server
		if err := tx.Where("uuid = ?", value).First(&server).Error; err == nil {
			return model.RecordServerOperationChanges(tx, actor, "credential", &server, server.ID, []model.ServerOperationChange{{Field: "agent_credential", Before: "共享认证", After: "独立密钥待接入"}})
		}
		return nil
	}); err != nil {
		return nil, err
	}
	publishAgentCredential(row)
	return &AgentCredentialPair{UUID: value, Secret: secret, Version: row.Version}, nil
}

// Called only after proving possession of a panel-registered key. Never falls
// back to UUID-only or account-wide authentication.
func AuthenticateAgentCredential(secret, value string) (uint64, error) {
	row, ok := AgentCredentialBySecret(secret)
	if !ok || row.UUID != value {
		return 0, errors.New("认证信息不匹配")
	}
	ServerMutationMu.Lock()
	defer ServerMutationMu.Unlock()
	current, ok := AgentCredentialByUUID(value)
	if !ok || current.SecretHash != row.SecretHash || current.Version != row.Version || IsDeletedServerUUID(value) {
		return 0, errors.New("认证信息已变化或封禁")
	}
	if ServerReplacementClearing(value) {
		return 0, errors.New("换机清理尚未完成")
	}
	UserLock.RLock()
	_, ownerExists := UserInfoMap[row.OwnerID]
	UserLock.RUnlock()
	if row.OwnerID != 0 && !ownerExists {
		return 0, errors.New("所属账号不存在")
	}
	var server *model.Server
	if id, found := ServerShared.UUIDToID(value); found {
		server, _ = ServerShared.Get(id)
		if server == nil {
			return 0, errors.New("服务器不存在")
		}
		ownerAllowed := server.GetUserID() == row.OwnerID
		if ServerTransferShared != nil {
			if transfer, pending := ServerTransferShared.LookupPending(id); pending {
				ownerAllowed = transfer.FromUserID == row.OwnerID
			}
		}
		if !ownerAllowed {
			return 0, errors.New("服务器归属已变化")
		}
	}
	if ServerIDReassignmentInProgress.Load() {
		return 0, errors.New("服务器 ID 正在调整")
	}
	newServer, firstVerification := server == nil, current.VerifiedAt == 0
	if newServer || firstVerification {
		if err := credentialDB().Transaction(func(tx *gorm.DB) error {
			if newServer {
				var err error
				server, err = createServerWithLowestAvailableIDInTx(tx, row.OwnerID, value, "新服务器")
				if err != nil {
					return err
				}
			}
			if !firstVerification {
				return nil
			}
			current.VerifiedAt = time.Now().Unix()
			result := tx.Model(&model.AgentCredential{}).Where("uuid = ? AND version = ? AND verified_at = 0", value, current.Version).
				Updates(map[string]any{"verified_at": current.VerifiedAt, "migration_requested": false, "last_error": ""})
			if result.Error != nil {
				return errors.New("无法确认认证信息")
			}
			if result.RowsAffected != 1 {
				return errors.New("认证信息已变化")
			}
			return nil
		}); err != nil {
			return 0, err
		}
	}
	if newServer {
		model.InitServer(server)
		ServerShared.Update(server, value)
	}
	if firstVerification {
		current.MigrationRequested = false
		current.LastError = ""
		publishAgentCredential(current)
		server.RevokeStreams()
	}
	return server.ID, nil
}

// Existing transfer/replacement credentials are already node-scoped. Adopt a
// successfully authenticated stable key without issuing or changing a key.
func AdoptAgentCredential(serverID uint64, value, secret string) error {
	if !AgentCredentialsReady() {
		return nil
	}
	ServerMutationMu.Lock()
	defer ServerMutationMu.Unlock()
	if IsDeletedServerUUID(value) {
		return errors.New("认证信息已封禁")
	}
	server, ok := ServerShared.Get(serverID)
	if !ok || server == nil || server.UUID != value {
		return errors.New("服务器已变化")
	}
	row, err := adoptAgentCredentialInTx(credentialDB(), server, value, secret)
	if err != nil {
		return err
	}
	if row != nil {
		publishAgentCredential(*row)
	}
	return nil
}

// Caller holds ServerMutationMu; publish the returned row only after commit.
func adoptAgentCredentialInTx(tx *gorm.DB, server *model.Server, value, secret string) (*model.AgentCredential, error) {
	if !AgentCredentialsReady() {
		return nil, nil
	}
	if IsDeletedServerUUID(value) {
		return nil, errors.New("认证信息已封禁")
	}
	hash := AgentCredentialHash(secret)
	previous, exists := AgentCredentialByUUID(value)
	if exists && previous.SecretHash == hash && previous.OwnerID == server.GetUserID() {
		return nil, nil
	}
	if other, found := AgentCredentialBySecret(secret); found && other.UUID != value {
		return nil, errors.New("密钥已绑定其他 UUID")
	}
	sealed, err := SealAgentSecret(secret)
	if err != nil {
		return nil, err
	}
	version := uint64(1)
	if exists {
		version = previous.Version + 1
	}
	row := model.AgentCredential{UUID: value, OwnerID: server.GetUserID(), SecretHash: hash, SecretSealed: sealed, Version: version, VerifiedAt: time.Now().Unix(), CreatedAt: time.Now()}
	if err := tx.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)}).Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "uuid"}}, UpdateAll: true}).Create(&row).Error; err != nil {
		return nil, errors.New("保存认证信息失败")
	}
	return &row, nil
}
func RequestAgentCredentialMigration(value string, version uint64) error {
	ServerMutationMu.Lock()
	defer ServerMutationMu.Unlock()
	row, ok := AgentCredentialByUUID(value)
	if !ok || row.Version != version || IsDeletedServerUUID(value) {
		return errors.New("认证信息已变化")
	}
	if row.VerifiedAt != 0 {
		return nil
	}
	if err := credentialDB().Model(&model.AgentCredential{}).Where("uuid = ? AND version = ?", value, version).Update("migration_requested", true).Error; err != nil {
		return err
	}
	row.MigrationRequested = true
	publishAgentCredential(row)
	return nil
}
func PendingAgentCredentials() []model.AgentCredential {
	agentCredentials.RLock()
	defer agentCredentials.RUnlock()
	rows := make([]model.AgentCredential, 0)
	for _, row := range agentCredentials.byUUID {
		if row.MigrationRequested && row.VerifiedAt == 0 {
			rows = append(rows, row)
		}
	}
	return rows
}
func AgentCredentialMigrationStatus(value string, version uint64, message string) error {
	ServerMutationMu.Lock()
	defer ServerMutationMu.Unlock()
	row, ok := AgentCredentialByUUID(value)
	if !ok || row.Version != version || row.VerifiedAt != 0 {
		return nil
	}
	row.LastAttemptAt = time.Now().Unix()
	row.LastError = message
	if err := credentialDB().Model(&model.AgentCredential{}).Where("uuid = ? AND version = ? AND verified_at = 0", value, version).
		Updates(map[string]any{"last_attempt_at": row.LastAttemptAt, "last_error": message}).Error; err != nil {
		return fmt.Errorf("更新密钥迁移状态失败")
	}
	publishAgentCredential(row)
	return nil
}
