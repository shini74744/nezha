//go:build linux

package dashboard

import (
	"errors"
	"os"

	"github.com/nezhahq/nezha/service/connectivity"
	"github.com/nezhahq/nezha/service/networkinsight"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Agent compatibility scenarios own their workload. Automatic public-site probes
// would introduce unrelated sockets, shell children and SQLite writes after the
// resource baseline. Seed only this disposable fixture; production defaults stay enabled.
func prepareIsolatedDatabase(path string) (result error) {
	// #nosec G304 -- Path is inside the harness-owned workspace; O_EXCL refuses existing files and symlinks.
	file, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		return err
	}
	raw, err := db.DB()
	if err != nil {
		return err
	}
	defer func() { result = errors.Join(result, raw.Close()) }()
	if err := db.AutoMigrate(&connectivity.Policy{}, &networkinsight.BGPPolicy{}); err != nil {
		return err
	}
	connectivityPolicy := connectivity.DefaultPolicy()
	connectivityPolicy.Enabled = false // Also governs automatic streaming detection.
	bgpPolicy := networkinsight.DefaultBGPPolicy()
	bgpPolicy.Enabled = false
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&connectivityPolicy).Error; err != nil {
			return err
		}
		return tx.Create(&bgpPolicy).Error
	})
}
