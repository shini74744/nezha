package singleton

import (
	"log"
	"path/filepath"

	"github.com/nezhahq/nezha/pkg/panelbackup"
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
	BackupManager.RunScheduler()
}
