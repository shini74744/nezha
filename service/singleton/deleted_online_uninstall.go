package singleton

import (
	"github.com/nezhahq/nezha/model"
	"gorm.io/gorm"
	"time"
)

// BeginDeletedOnlineUninstall never registers or releases a UUID. The caller
// holds a one-shot capability for the connection that existed before deletion.
func BeginDeletedOnlineUninstall(row model.ServerDeletionTombstone) (bool, error) {
	ServerMutationMu.Lock()
	defer ServerMutationMu.Unlock()
	result := DB.Model(&model.ServerDeletionTombstone{}).
		Where("uuid = ? AND block_version = ? AND cleanup_revision = ? AND released_at = 0 AND record_deleted_at = 0 AND cleanup_attempts = 0", row.UUID, row.BlockVersion, row.CleanupRevision).
		Updates(map[string]any{"cleanup_state": "online_running", "cleanup_attempts": 1, "cleanup_last_attempt_at": time.Now().Unix(), "cleanup_message": "正在尝试卸载"})
	return result.RowsAffected == 1, result.Error
}
func FinishDeletedOnlineUninstall(row model.ServerDeletionTombstone, state, message string) error {
	ServerMutationMu.Lock()
	defer ServerMutationMu.Unlock()
	return DB.Model(&model.ServerDeletionTombstone{}).
		Where("uuid = ? AND block_version = ? AND cleanup_revision = ? AND released_at = 0 AND record_deleted_at = 0", row.UUID, row.BlockVersion, row.CleanupRevision).
		Updates(map[string]any{"cleanup_state": state, "cleanup_message": message}).Error
}

// Retire armed reconnect jobs from older versions. Keep blacklist decisions,
// history and database columns so rollback does not lose records.
func retireDeletedCleanup() error {
	return DB.Model(&model.ServerDeletionTombstone{}).
		Where("cleanup_enabled = ? OR cleanup_state IN ?", true, []string{"waiting", "sending", "retry_wait", "quiet", "online_running"}).
		Updates(map[string]any{"cleanup_enabled": false, "cleanup_revision": gorm.Expr("cleanup_revision + 1"), "cleanup_state": "off", "cleanup_message": "未确认卸载结果，请在服务器上手动检查", "cleanup_next_attempt_at": 0, "cleanup_credential_hash": ""}).Error
}
