package rpc

import (
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"time"
)

// Check the key itself before consulting/parsing the UUID supplied by a peer.
// Binding and block status are checked only after this independent key proof.
func registeredAgentSecret(secret string) bool {
	if secret == "" || len(secret) > 4096 {
		return false
	}
	if _, ok := singleton.AgentCredentialBySecret(secret); ok {
		return true
	}
	singleton.UserLock.RLock()
	_, legacy := singleton.AgentSecretToUserId[secret]
	singleton.UserLock.RUnlock()
	if legacy {
		return true
	}
	if transfers := singleton.ServerTransferShared; transfers != nil {
		if _, ok := transfers.LookupByHandshakeSecret(secret); ok {
			return true
		}
		if _, _, ok := transfers.LookupByTerminalSecretRecovery(secret); ok {
			return true
		}
		if _, ok := transfers.LookupServerByVerifiedHandshakeSecret(secret); ok {
			return true
		}
	}
	if singleton.IsReplacementSecret(secret) {
		var count int64
		err := singleton.DB.Model(&model.ServerReplacement{}).
			Where("token_hash = ? AND (state IN ? OR (state = ? AND expires_at > ?))", singleton.AgentCredentialHash(secret), []string{"active", "clearing"}, "pending", time.Now()).Count(&count).Error
		return err == nil && count == 1
	}
	return false
}

func credentialTransitionAllowed(secret, value string) bool {
	if transfers := singleton.ServerTransferShared; transfers != nil {
		if transfer, ok := transfers.LookupByHandshakeSecret(secret); ok {
			if id, found := singleton.ServerShared.UUIDToID(value); found && id == transfer.ServerID {
				return true
			}
		}
		if transfer, _, ok := transfers.LookupByTerminalSecretRecovery(secret); ok {
			if id, found := singleton.ServerShared.UUIDToID(value); found && id == transfer.ServerID {
				return true
			}
		}
	}
	if singleton.IsReplacementSecret(secret) {
		row, _, err := singleton.AuthorizeServerReplacement(secret, value)
		return err == nil && row != nil && (row.State == "pending" || row.State == "clearing")
	}
	return false
}
