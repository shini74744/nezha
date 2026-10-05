package singleton

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/hashicorp/go-uuid"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/agentuninstall"
	"gorm.io/gorm"
)

// Only irreversible hashes of already-verified transfer credentials are retained.
// Normal user credentials are checked against the CURRENT owner credential map.
func cleanupCredentialHash(secret string) string {
	if secret == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

func (c *ServerTransferClass) deletedCleanupIdentity(id, owner uint64) (uint64, string) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	// Do not authorize the destination user's global key while ownership is unsettled.
	if c.pending[id] != nil || c.terminalSecretRecovery[id] != nil || c.revertDeliveries[id] != nil {
		return 0, ""
	}
	return owner, cleanupCredentialHash(c.verifiedHandshakes[id])
}

func DescribeDeletedCleanup(row *model.ServerDeletionTombstone) {
	row.CleanupUnavailable = ""
	switch {
	case row.ReleasedAt != 0:
		row.CleanupUnavailable = "UUID 已放行，不能执行删除清理"
	case row.CleanupOwnerID == 0:
		row.CleanupUnavailable = "记录缺少可靠的原所属用户（旧记录或转移未完成），无法安全校验重连身份"
	case row.CleanupPlatform == "":
		row.CleanupUnavailable = "删除时未记录操作系统，无法安全选择卸载命令"
	default:
		if _, err := agentuninstall.Command(row.UUID, row.CleanupPlatform); err != nil {
			row.CleanupUnavailable = "特殊节点或非标准 UUID 不支持自动卸载"
		}
	}
}

func cleanupAudit(tx *gorm.DB, row *model.ServerDeletionTombstone, actor model.ServerOperationActor, before, after string) error {
	server := &model.Server{Common: model.Common{ID: row.OriginalID}, UUID: row.UUID, Name: row.Name}
	return model.RecordServerOperationChanges(tx, actor, "deleted_cleanup", server, row.OriginalID,
		[]model.ServerOperationChange{{Field: "deleted_cleanup", Before: before, After: after}})
}

func ConfigureDeletedCleanup(value string, version, revision uint64, enabled bool, actor model.ServerOperationActor) (*model.ServerDeletionTombstone, error) {
	if _, err := uuid.ParseUUID(value); err != nil || version == 0 {
		return nil, fmt.Errorf("UUID 或封禁版本不合法")
	}
	ServerMutationMu.Lock()
	defer ServerMutationMu.Unlock()
	var row model.ServerDeletionTombstone
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&row, "uuid = ?", value).Error; err != nil {
			return err
		}
		if row.BlockVersion != version || row.CleanupRevision != revision {
			return fmt.Errorf("清理设置已变化，请刷新后重新确认")
		}
		DescribeDeletedCleanup(&row)
		if enabled {
			if row.CleanupUnavailable != "" {
				return errors.New(row.CleanupUnavailable)
			}
			UserLock.RLock()
			_, exists := UserInfoMap[row.CleanupOwnerID]
			UserLock.RUnlock()
			if !exists {
				return fmt.Errorf("原所属用户已不存在，无法安全校验重连身份")
			}
			if row.CleanupEnabled {
				return fmt.Errorf("已有清理任务，请先关闭或等待本次结果")
			}
		} else if !row.CleanupEnabled {
			return nil
		}
		before := row.CleanupState
		row.CleanupEnabled = enabled
		row.CleanupRevision++
		if enabled {
			row.CleanupState, row.CleanupMessage = "waiting", "等待节点携带有效凭据重连；仅尝试一次"
		} else {
			row.CleanupState, row.CleanupMessage = "cancelled", "已关闭；已下发的命令无法撤回"
		}
		if err := tx.Model(&model.ServerDeletionTombstone{}).Where("uuid = ?", value).
			Updates(map[string]any{"cleanup_enabled": enabled, "cleanup_revision": row.CleanupRevision, "cleanup_state": row.CleanupState, "cleanup_message": row.CleanupMessage}).Error; err != nil {
			return err
		}
		return cleanupAudit(tx, &row, actor, before, row.CleanupMessage)
	})
	return &row, err
}

func deletedCleanupCredentialMatches(row *model.ServerDeletionTombstone, secret string) bool {
	if secret == "" || len(secret) > 4096 || row.CleanupOwnerID == 0 {
		return false
	}
	UserLock.RLock()
	_, ownerExists := UserInfoMap[row.CleanupOwnerID]
	owner, mapped := AgentSecretToUserId[secret]
	UserLock.RUnlock()
	if !ownerExists {
		return false
	}
	if mapped && owner == row.CleanupOwnerID {
		return true
	}
	digest := cleanupCredentialHash(secret)
	return row.CleanupCredentialHash != "" && subtle.ConstantTimeCompare([]byte(digest), []byte(row.CleanupCredentialHash)) == 1
}

// This grants access ONLY to the cleanup RPC branch, never auth.Check or ServerShared.
// All ordinary monitoring, terminal, file and transfer methods remain blocked.
func AuthorizeDeletedCleanup(value, secret string) (*model.ServerDeletionTombstone, bool) {
	if !IsDeletedServerUUID(value) || DB == nil {
		return nil, false
	}
	var row model.ServerDeletionTombstone
	if err := DB.First(&row, "uuid = ?", value).Error; err != nil {
		return nil, false
	}
	if row.ReleasedAt != 0 || !row.CleanupEnabled || (row.CleanupState != "waiting" && row.CleanupState != "sending") {
		return nil, false
	}
	DescribeDeletedCleanup(&row)
	if row.CleanupUnavailable != "" || !deletedCleanupCredentialMatches(&row, secret) {
		return nil, false
	}
	return &row, true
}

var ErrDeletedCleanupChanged = errors.New("清理任务已变化或已取消")

// send must be bounded. Serializing the final check and Send with configuration,
// release and deletion prevents new dispatch after cancellation. An in-flight Send cannot be recalled.
func DispatchDeletedCleanup(expected *model.ServerDeletionTombstone, secret string, send func() error) error {
	ServerMutationMu.Lock()
	defer ServerMutationMu.Unlock()
	var row model.ServerDeletionTombstone
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&row, "uuid = ?", expected.UUID).Error; err != nil {
			return err
		}
		if row.BlockVersion != expected.BlockVersion || row.CleanupRevision != expected.CleanupRevision ||
			!row.CleanupEnabled || row.ReleasedAt != 0 || row.CleanupState != "waiting" ||
			!deletedCleanupCredentialMatches(&row, secret) {
			return ErrDeletedCleanupChanged
		}
		row.CleanupState, row.CleanupMessage = "sending", "卸载任务正在下发；尚未收到启动确认"
		row.CleanupLastAttemptAt = time.Now().Unix()
		row.CleanupAttempts++
		if err := tx.Model(&model.ServerDeletionTombstone{}).Where("uuid = ?", row.UUID).
			Updates(map[string]any{"cleanup_state": row.CleanupState, "cleanup_message": row.CleanupMessage, "cleanup_attempts": row.CleanupAttempts, "cleanup_last_attempt_at": row.CleanupLastAttemptAt}).Error; err != nil {
			return err
		}
		return cleanupAudit(tx, &row, model.ServerOperationActor{Name: "重连自动清理", Source: "system"}, "等待重连", row.CleanupMessage)
	})
	if err != nil {
		return err
	}
	return send()
}

// Persist only fixed status messages, never untrusted Agent output or credentials.
func FinishDeletedCleanup(expected *model.ServerDeletionTombstone, state, message string) error {
	if state != "started" && state != "failed" && state != "unknown" {
		return fmt.Errorf("invalid cleanup state")
	}
	ServerMutationMu.Lock()
	defer ServerMutationMu.Unlock()
	return DB.Transaction(func(tx *gorm.DB) error {
		var row model.ServerDeletionTombstone
		if err := tx.First(&row, "uuid = ?", expected.UUID).Error; err != nil {
			return err
		}
		if row.BlockVersion != expected.BlockVersion || row.CleanupRevision != expected.CleanupRevision ||
			row.ReleasedAt != 0 || !row.CleanupEnabled || (row.CleanupState != "sending" && !(state == "failed" && row.CleanupState == "waiting")) {
			return ErrDeletedCleanupChanged
		}
		if err := tx.Model(&model.ServerDeletionTombstone{}).Where("uuid = ?", row.UUID).
			Updates(map[string]any{"cleanup_enabled": false, "cleanup_state": state, "cleanup_message": message}).Error; err != nil {
			return err
		}
		return cleanupAudit(tx, &row, model.ServerOperationActor{Name: "重连自动清理", Source: "system"}, row.CleanupState, message)
	})
}

func cleanupPlatformMatches(stored, reported string) bool {
	return strings.Contains(strings.ToLower(stored), "windows") == strings.Contains(strings.ToLower(reported), "windows")
}

func DeletedCleanupHostAllowed(row *model.ServerDeletionTombstone, platform string) bool {
	if platform == "" || !cleanupPlatformMatches(row.CleanupPlatform, platform) {
		return false
	}
	_, err := agentuninstall.Command(row.UUID, platform)
	return err == nil
}

func recoverDeletedCleanup() error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var rows []model.ServerDeletionTombstone
		if err := tx.Where("cleanup_state = ?", "sending").Find(&rows).Error; err != nil {
			return err
		}
		for i := range rows {
			row := &rows[i]
			message := "面板重启导致回执中断，清理结果未知；不会自动重试"
			if err := tx.Model(row).Updates(map[string]any{"cleanup_enabled": false, "cleanup_state": "unknown", "cleanup_message": message}).Error; err != nil {
				return err
			}
			if err := cleanupAudit(tx, row, model.ServerOperationActor{Name: "系统恢复", Source: "system"}, "任务下发中", message); err != nil {
				return err
			}
		}
		return nil
	})
}
