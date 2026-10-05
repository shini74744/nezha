package singleton

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/hashicorp/go-uuid"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/agentuninstall"
	"gorm.io/gorm"
)

const DeletedCleanupRetrySeconds int64 = 60
const DeletedCleanupMaxAttempts uint64 = 3

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
			row.CleanupState, row.CleanupMessage = "waiting", "等待有效重连后立即卸载；间隔 1 分钟检查，本轮最多 3 次"
			row.CleanupMaxAttempts, row.CleanupRoundAttempts = DeletedCleanupMaxAttempts, 0
			row.CleanupLastVerifiedAt, row.CleanupCheckedAt, row.CleanupNextAttemptAt = 0, 0, 0
			row.CleanupLastResult = ""
		} else {
			row.CleanupState, row.CleanupMessage = "cancelled", "已关闭；已下发的命令无法撤回"
			row.CleanupNextAttemptAt = 0
		}
		if err := tx.Model(&model.ServerDeletionTombstone{}).Where("uuid = ?", value).
			Updates(map[string]any{"cleanup_enabled": enabled, "cleanup_revision": row.CleanupRevision, "cleanup_state": row.CleanupState, "cleanup_message": row.CleanupMessage,
				"cleanup_max_attempts": row.CleanupMaxAttempts, "cleanup_round_attempts": row.CleanupRoundAttempts,
				"cleanup_next_attempt_at": row.CleanupNextAttemptAt, "cleanup_checked_at": row.CleanupCheckedAt,
				"cleanup_last_verified_at": row.CleanupLastVerifiedAt, "cleanup_last_result": row.CleanupLastResult}).Error; err != nil {
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
	if row.ReleasedAt != 0 || !row.CleanupEnabled || (row.CleanupState != "waiting" && row.CleanupState != "sending" && row.CleanupState != "retry_wait" && row.CleanupState != "quiet") {
		return nil, false
	}
	DescribeDeletedCleanup(&row)
	if row.CleanupUnavailable != "" || !deletedCleanupCredentialMatches(&row, secret) {
		return nil, false
	}
	return &row, true
}

var ErrDeletedCleanupChanged = errors.New("清理任务已变化或已取消")
var ErrDeletedCleanupLimit = errors.New("清理次数已用尽，需要人工检查")

func cleanupPending(state string) bool {
	return state == "waiting" || state == "retry_wait" || state == "quiet"
}

// Observe only authenticated cleanup handshakes. Generic rejected report counters
// cannot prove reachability and must never trigger retry exhaustion.
func ObserveDeletedCleanup(expected *model.ServerDeletionTombstone, secret string) bool {
	ServerMutationMu.Lock()
	defer ServerMutationMu.Unlock()
	var row model.ServerDeletionTombstone
	if DB.First(&row, "uuid = ?", expected.UUID).Error != nil ||
		row.BlockVersion != expected.BlockVersion || row.CleanupRevision != expected.CleanupRevision ||
		!row.CleanupEnabled || row.ReleasedAt != 0 ||
		(!cleanupPending(row.CleanupState) && row.CleanupState != "sending") ||
		!deletedCleanupCredentialMatches(&row, secret) {
		return false
	}
	now := time.Now().Unix()
	if row.CleanupLastVerifiedAt != now {
		if DB.Model(&row).Update("cleanup_last_verified_at", now).Error != nil {
			return false
		}
	}
	return row.CleanupNextAttemptAt <= now
}

// send must be bounded. The durable attempt reservation precedes Send and is
// serialized with cancellation/release. An in-flight Send cannot be recalled.
func DispatchDeletedCleanup(expected *model.ServerDeletionTombstone, secret string, send func() error) error {
	ServerMutationMu.Lock()
	defer ServerMutationMu.Unlock()
	var row model.ServerDeletionTombstone
	limited := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&row, "uuid = ?", expected.UUID).Error; err != nil {
			return err
		}
		now := time.Now().Unix()
		if row.BlockVersion != expected.BlockVersion || row.CleanupRevision != expected.CleanupRevision ||
			!row.CleanupEnabled || row.ReleasedAt != 0 || !cleanupPending(row.CleanupState) ||
			row.CleanupNextAttemptAt > now || !deletedCleanupCredentialMatches(&row, secret) {
			return ErrDeletedCleanupChanged
		}
		// A fresh authenticated RequestTask proves the command channel is still
		// reachable after the final cooldown. Stop, never send attempt four.
		if row.CleanupRoundAttempts >= row.CleanupMaxAttempts || row.CleanupMaxAttempts == 0 {
			limited = true
			message := "多次卸载后仍可连接命令通道，已停止自动重试；请检查权限、守护进程或安装方式"
			if err := tx.Model(&row).Updates(map[string]any{
				"cleanup_enabled": false, "cleanup_state": "attention", "cleanup_message": message,
				"cleanup_next_attempt_at": 0, "cleanup_checked_at": now, "cleanup_last_verified_at": now,
			}).Error; err != nil {
				return err
			}
			return cleanupAudit(tx, &row, model.ServerOperationActor{Name: "重连自动清理", Source: "system"}, "等待检查", message)
		}
		row.CleanupState, row.CleanupMessage = "sending", "卸载任务正在下发；尚未收到启动确认"
		row.CleanupLastAttemptAt = now
		row.CleanupAttempts++
		row.CleanupRoundAttempts++
		if err := tx.Model(&model.ServerDeletionTombstone{}).Where("uuid = ?", row.UUID).
			Updates(map[string]any{"cleanup_state": row.CleanupState, "cleanup_message": row.CleanupMessage,
				"cleanup_attempts": row.CleanupAttempts, "cleanup_round_attempts": row.CleanupRoundAttempts,
				"cleanup_last_attempt_at": now, "cleanup_last_verified_at": now,
				"cleanup_next_attempt_at": now + DeletedCleanupRetrySeconds}).Error; err != nil {
			return err
		}
		return cleanupAudit(tx, &row, model.ServerOperationActor{Name: "重连自动清理", Source: "system"}, "等待重连",
			fmt.Sprintf("第 %d/%d 次：%s", row.CleanupRoundAttempts, row.CleanupMaxAttempts, row.CleanupMessage))
	})
	if err != nil {
		return err
	}
	if limited {
		return ErrDeletedCleanupLimit
	}
	// Bind the result to this exact attempt, not only to the arming revision.
	expected.CleanupAttempts = row.CleanupAttempts
	expected.CleanupRoundAttempts = row.CleanupRoundAttempts
	return send()
}

// Persist only fixed status messages, never untrusted Agent output or credentials.
func FinishDeletedCleanup(expected *model.ServerDeletionTombstone, state, message string) error {
	if state != "started" && state != "failed" && state != "unknown" && state != "unsafe" {
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
			row.CleanupAttempts != expected.CleanupAttempts || row.ReleasedAt != 0 || !row.CleanupEnabled ||
			(row.CleanupState != "sending" && !(state == "unsafe" && cleanupPending(row.CleanupState))) {
			return ErrDeletedCleanupChanged
		}
		next, enabled, nextState := int64(0), false, state
		if state == "unsafe" {
			// Host/platform mismatch is a safety stop, even during an in-flight attempt.
			nextState = "attention"
		} else if row.CleanupMaxAttempts > 1 {
			next, enabled, nextState = time.Now().Unix()+DeletedCleanupRetrySeconds, true, "retry_wait"
			message += "；1 分钟后检查，仍可连接时按剩余次数重试"
		}
		if err := tx.Model(&model.ServerDeletionTombstone{}).Where("uuid = ?", row.UUID).
			Updates(map[string]any{"cleanup_enabled": enabled, "cleanup_state": nextState,
				"cleanup_last_result": state, "cleanup_message": message, "cleanup_next_attempt_at": next}).Error; err != nil {
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

// Periodic checks are passive: no SSH password, no probe by historical IP, and no
// invented "uninstall succeeded". A real authenticated task stream dispatches retries.
func checkDeletedCleanupAt(now int64) error {
	ServerMutationMu.Lock()
	defer ServerMutationMu.Unlock()
	return DB.Transaction(func(tx *gorm.DB) error {
		// Send/receipt normally finishes within 15 seconds. A stale reservation
		// means persistence or the worker failed; keep the consumed attempt.
		var stalled []model.ServerDeletionTombstone
		if err := tx.Where("cleanup_enabled = ? AND released_at = 0 AND cleanup_state = ? AND cleanup_last_attempt_at <= ?",
			true, "sending", now-DeletedCleanupRetrySeconds).Find(&stalled).Error; err != nil {
			return err
		}
		for i := range stalled {
			row := &stalled[i]
			enabled, next, state := row.CleanupMaxAttempts > 1, int64(0), "unknown"
			message := "任务状态未及时确认，结果未知"
			if enabled {
				next, state = now+DeletedCleanupRetrySeconds, "retry_wait"
				message += "；保留已用次数，1 分钟后继续检查"
			}
			if err := tx.Model(row).Updates(map[string]any{"cleanup_enabled": enabled, "cleanup_state": state,
				"cleanup_last_result": "unknown", "cleanup_message": message, "cleanup_next_attempt_at": next}).Error; err != nil {
				return err
			}
			if err := cleanupAudit(tx, row, model.ServerOperationActor{Name: "清理状态恢复", Source: "system"}, "任务下发中", message); err != nil {
				return err
			}
		}
		var rows []model.ServerDeletionTombstone
		if err := tx.Where("cleanup_enabled = ? AND released_at = 0 AND cleanup_state IN ? AND cleanup_next_attempt_at > 0 AND cleanup_next_attempt_at <= ? AND cleanup_checked_at <= ?",
			true, []string{"retry_wait", "quiet"}, now, now-DeletedCleanupRetrySeconds).Find(&rows).Error; err != nil {
			return err
		}
		for i := range rows {
			row := &rows[i]
			state, message := "quiet", "未再收到有效上报，继续等待；未确认卸载完成"
			if row.CleanupLastVerifiedAt > now-DeletedCleanupRetrySeconds {
				state, message = "retry_wait", "仍有有效上报，等待建立命令通道后检查并重试"
			}
			if err := tx.Model(row).Updates(map[string]any{"cleanup_state": state, "cleanup_message": message, "cleanup_checked_at": now}).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func DeletedCleanupCheckerStart() {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for now := range ticker.C {
		if err := checkDeletedCleanupAt(now.Unix()); err != nil {
			log.Printf("NEZHA>> check deleted-agent cleanup failed: %v", err)
			// Avoid a tight log/error loop on storage failure.
			time.Sleep(time.Minute)
		}
	}
}

func recoverDeletedCleanup() error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var rows []model.ServerDeletionTombstone
		if err := tx.Where("cleanup_state = ?", "sending").Find(&rows).Error; err != nil {
			return err
		}
		for i := range rows {
			row := &rows[i]
			state, enabled, next := "unknown", false, int64(0)
			message := "面板重启导致回执中断，清理结果未知"
			if row.CleanupEnabled && row.ReleasedAt == 0 && row.CleanupMaxAttempts > 1 {
				state, enabled, next = "retry_wait", true, time.Now().Unix()+DeletedCleanupRetrySeconds
				message += "；保留已用次数，1 分钟后继续检查"
			}
			if err := tx.Model(row).Updates(map[string]any{"cleanup_enabled": enabled,
				"cleanup_state": state, "cleanup_message": message, "cleanup_last_result": "unknown",
				"cleanup_next_attempt_at": next}).Error; err != nil {
				return err
			}
			if err := cleanupAudit(tx, row, model.ServerOperationActor{Name: "系统恢复", Source: "system"}, "任务下发中", message); err != nil {
				return err
			}
		}
		return nil
	})
}
