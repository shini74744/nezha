package singleton

import (
	"fmt"
	"time"

	"github.com/hashicorp/go-uuid"
	"github.com/nezhahq/nezha/model"
	"gorm.io/gorm"
)

// The tombstone is also the persistent UUID blocklist. Hide the deleted-server
// card and clear cleanup/report data, retaining blacklist identity and history.
// Serialize with release, re-deletion and cleanup sends. No remote command is sent.
func DeleteDeletedServerRecord(value string, version, revision uint64, actor model.ServerOperationActor) error {
	if _, err := uuid.ParseUUID(value); err != nil || version == 0 {
		return fmt.Errorf("UUID 或记录版本不合法")
	}
	ServerMutationMu.Lock()
	defer ServerMutationMu.Unlock()
	return DB.Transaction(func(tx *gorm.DB) error {
		var row model.ServerDeletionTombstone
		if err := tx.First(&row, "uuid = ?", value).Error; err != nil {
			return err
		}
		// Repeating a successful removal is harmless; a new deletion resets this marker.
		if row.RecordDeletedAt != 0 {
			return nil
		}
		if row.BlockVersion != version || row.CleanupRevision != revision {
			return fmt.Errorf("删除记录已变化，请刷新后重新确认")
		}
		server := &model.Server{Common: model.Common{ID: row.OriginalID}, UUID: row.UUID, Name: row.Name}
		after := "记录已删除，UUID 继续拦截"
		if row.ReleasedAt != 0 {
			after = "记录已删除，UUID 保持已放行"
		}
		if err := model.RecordServerOperationChanges(tx, actor, "delete_record", server, row.OriginalID,
			[]model.ServerOperationChange{{Field: "deleted_record", Before: "保留删除记录", After: after}}); err != nil {
			return err
		}
		result := tx.Model(&model.ServerDeletionTombstone{}).
			Where("uuid = ? AND block_version = ? AND cleanup_revision = ? AND record_deleted_at = 0", value, version, revision).
			Updates(map[string]any{
				"record_deleted_at": time.Now().Unix(),
				"block_version":     gorm.Expr("block_version + 1"),
				"last_ip":           "", "first_report_at": 0, "last_report_at": 0, "report_count": 0,
				"cleanup_enabled": false, "cleanup_revision": gorm.Expr("cleanup_revision + 1"),
				"cleanup_owner_id": 0, "cleanup_credential_hash": "", "cleanup_platform": "",
				"cleanup_state": "off", "cleanup_attempts": 0, "cleanup_last_attempt_at": 0, "cleanup_message": "",
				"cleanup_max_attempts": 1, "cleanup_round_attempts": 0, "cleanup_next_attempt_at": 0,
				"cleanup_checked_at": 0, "cleanup_last_verified_at": 0, "cleanup_last_result": "",
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return fmt.Errorf("删除记录已变化，请刷新后重试")
		}
		return nil
	})
}
