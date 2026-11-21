package singleton

import (
	"github.com/nezhahq/nezha/model"
	"gorm.io/gorm"
)

// Preserve existing DDnezha integrations exactly once. Column creation and
// backfill are atomic: restarts must never revive invalidated credentials.
func migrateAPITokenVersions(db *gorm.DB) error {
	if !db.Migrator().HasTable(&model.APIToken{}) || db.Migrator().HasColumn(&model.APIToken{}, "UserVersion") {
		return nil
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Migrator().AddColumn(&model.APIToken{}, "UserVersion"); err != nil {
			return err
		}
		return tx.Exec("UPDATE api_tokens SET user_version = COALESCE((SELECT token_version FROM users WHERE users.id = api_tokens.user_id), 0)").Error
	})
}
