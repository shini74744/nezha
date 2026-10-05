package singleton

import (
	"errors"
	"fmt"
	"time"

	"github.com/hashicorp/go-uuid"
	"github.com/nezhahq/nezha/model"
	"gorm.io/gorm"
)

// Serialize with deletion and registration. Commit the audit and persistent
// release before removing the in-memory block; database failure stays blocked.
func ReleaseDeletedServerUUID(value string, version uint64, actor model.ServerOperationActor) (*model.ServerDeletionTombstone, error) {
	if _, err := uuid.ParseUUID(value); err != nil || version == 0 {
		return nil, fmt.Errorf("UUID 或封禁版本不合法")
	}
	ServerMutationMu.Lock()
	defer ServerMutationMu.Unlock()
	var row model.ServerDeletionTombstone
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&row, "uuid = ?", value).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return fmt.Errorf("未找到该 UUID 的删除记录，请刷新后重试")
			}
			return err
		}
		if row.BlockVersion != version {
			return fmt.Errorf("封禁记录已变化，请刷新后重新确认")
		}
		if row.ReleasedAt != 0 {
			return nil
		}
		releasedAt := time.Now().Unix()
		result := tx.Model(&model.ServerDeletionTombstone{}).
			Where("uuid = ? AND block_version = ? AND released_at = 0", value, version).
			Updates(map[string]any{"released_at": releasedAt, "released_by_id": actor.ID, "released_by_name": actor.Name,
				"cleanup_enabled": false, "cleanup_revision": gorm.Expr("cleanup_revision + 1"), "cleanup_credential_hash": "", "cleanup_next_attempt_at": 0})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return fmt.Errorf("封禁记录已变化，请刷新后重新确认")
		}
		server := &model.Server{Common: model.Common{ID: row.OriginalID}, UUID: row.UUID, Name: row.Name}
		if err := model.RecordServerOperationChanges(tx, actor, "release_uuid", server, row.OriginalID,
			[]model.ServerOperationChange{{Field: "uuid_block", Before: "已拉黑", After: "已放行（仍需有效密钥）"}}); err != nil {
			return err
		}
		row.CleanupEnabled, row.CleanupCredentialHash = false, ""
		row.CleanupNextAttemptAt = 0
		row.CleanupRevision++
		row.ReleasedAt, row.ReleasedByID, row.ReleasedByName = releasedAt, actor.ID, actor.Name
		return nil
	})
	if err != nil {
		return nil, err
	}
	unblockDeletedServerUUIDs([]string{value})
	return &row, nil
}
