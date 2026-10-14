package singleton

import (
	"errors"
	"github.com/nezhahq/nezha/model"
	"gorm.io/gorm"
)

func UnusedAgentCredentialPair(value string, version, owner uint64, remove bool, actor model.ServerOperationActor) (*AgentCredentialPair, error) {
	ServerMutationMu.Lock()
	defer ServerMutationMu.Unlock()
	row, ok := AgentCredentialByUUID(value)
	if !ok || row.OwnerID != owner || row.Version != version || row.VerifiedAt != 0 {
		return nil, errors.New("认证信息已使用或已变化，请刷新")
	}
	var exists int64
	if err := DB.Model(&model.Server{}).Where("uuid = ?", value).Count(&exists).Error; err != nil {
		return nil, err
	}
	if exists > 0 || IsDeletedServerUUID(value) {
		return nil, errors.New("此认证信息不能按未使用记录处理")
	}
	if !remove {
		secret, err := OpenAgentSecret(row.SecretSealed)
		if err != nil {
			return nil, err
		}
		return &AgentCredentialPair{UUID: value, Secret: secret, Version: version}, nil
	}
	err := credentialDB().Transaction(func(tx *gorm.DB) error {
		result := tx.Where("uuid = ? AND version = ? AND verified_at = 0", value, version).Delete(&model.AgentCredential{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("认证信息已变化")
		}
		server := &model.Server{UUID: value, Name: "未使用认证信息"}
		return model.RecordServerOperationChanges(tx, actor, "discard_credential", server, 0, []model.ServerOperationChange{{Field: "agent_credential", Before: "未使用配对", After: "已作废"}})
	})
	if err != nil {
		return nil, err
	}
	agentCredentials.Lock()
	delete(agentCredentials.byUUID, value)
	delete(agentCredentials.byHash, row.SecretHash)
	agentCredentials.Unlock()
	return nil, nil
}
