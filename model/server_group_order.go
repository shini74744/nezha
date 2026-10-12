package model

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"

	"gorm.io/gorm"
)

// ServerGroupRevision binds a mutation to the group the caller actually read.
// Numeric IDs are reused after compaction, so an ID alone is not a safe target.
func ServerGroupRevision(group ServerGroup) string {
	raw, _ := json.Marshal(struct {
		ServerGroup
		OwnerID uint64
	}{group, group.UserID})
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// CompactServerGroupIDs must run inside the caller's write transaction.
// Move in ascending order: every destination is either unchanged or already
// vacant. Memberships move with their group; server IDs and history do not.
func CompactServerGroupIDs(tx *gorm.DB) error {
	var groups []ServerGroup
	if err := tx.Order("id ASC").Find(&groups).Error; err != nil {
		return err
	}
	var orphans int64
	if err := tx.Model(&ServerGroupServer{}).
		Where("server_group_id NOT IN (SELECT id FROM server_groups)").
		Count(&orphans).Error; err != nil {
		return err
	}
	if orphans != 0 {
		return errors.New("server group memberships contain orphan references; compaction cancelled")
	}
	for index, group := range groups {
		next := uint64(index + 1)
		if group.ID == next {
			continue
		}
		if group.ID < next {
			return errors.New("invalid server group ID; compaction cancelled")
		}
		if err := tx.Model(&ServerGroup{}).Where("id = ?", group.ID).UpdateColumn("id", next).Error; err != nil {
			return err
		}
		if err := tx.Model(&ServerGroupServer{}).Where("server_group_id = ?", group.ID).
			UpdateColumn("server_group_id", next).Error; err != nil {
			return err
		}
	}
	// SQLite AUTOINCREMENT otherwise remembers the old highest deleted ID.
	return tx.Exec("UPDATE sqlite_sequence SET seq = ? WHERE name = ?", len(groups), "server_groups").Error
}
