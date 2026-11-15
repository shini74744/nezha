package singleton

import (
	"log"
	"path/filepath"
	"strings"

	"github.com/nezhahq/nezha/pkg/panelbackup"
	"gorm.io/gorm"
)

var BackupManager *panelbackup.Manager
var BackupInitError error

func InitBackups(configPath, dbPath string) {
	source := panelbackup.Source{Database: dbPath, Config: configPath, DataDir: filepath.Join("data"), TSDBDir: Conf.TSDB.DataPath, Version: Version, Location: Loc}
	if TSDBShared != nil {
		source.TSDBSnapshot = TSDBShared.CreateBackupSnapshot
	}
	BackupManager, BackupInitError = panelbackup.New(DB, source)
	if BackupInitError != nil {
		log.Printf("NEZHA>> Backup unavailable: %v", BackupInitError)
		return
	}
	mark := func(tx *gorm.DB) {
		if tx.Error == nil && tx.Statement != nil && !strings.HasPrefix(tx.Statement.Table, "panel_backup_") {
			BackupManager.NotifyChange()
		}
	}
	_ = DB.Callback().Create().After("gorm:create").Register("ddnezha:backup_change", mark)
	_ = DB.Callback().Update().After("gorm:update").Register("ddnezha:backup_change", mark)
	_ = DB.Callback().Delete().After("gorm:delete").Register("ddnezha:backup_change", mark)
	BackupManager.RunScheduler()
}
