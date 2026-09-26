package singleton

import (
	"fmt"
	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func snapshotFixture(t *testing.T) (string, *model.Server) {
	setupPermanentDeleteTest(t)
	require.NoError(t, DB.AutoMigrate(&model.ServerSnapshot{}))
	server := &model.Server{Common: model.Common{ID: 11, UserID: 1}, UUID: "snapshot-11", Name: "snapshot"}
	require.NoError(t, DB.Create(server).Error)
	model.InitServer(server)
	ServerShared.Update(server, server.UUID)
	return "snapshot-11", server
}
func sampleAt(at int64) model.RecordedServerState {
	return model.RecordedServerState{At: at, CountryCode: "JP", Host: &model.Host{Platform: "ubuntu", PlatformVersion: "24.04", CPU: []string{"AMD EPYC"}, MemTotal: 8 << 30, DiskTotal: 100 << 30, SwapTotal: 2 << 30, BootTime: 123, Version: "2.3.5", Arch: "x86_64"},
		State: &model.HostState{CPU: 12.5, MemUsed: 2 << 30, DiskUsed: 25 << 30, SwapUsed: 1 << 30, Load1: 1.2, Uptime: 90, NetOutTransfer: 5 << 30}}
}
func TestSnapshotMinuteRetentionRestartAndOfflineFreeze(t *testing.T) {
	uuid, _ := snapshotFixture(t)
	base := time.Now().Add(-90 * 24 * time.Hour).Truncate(time.Second).UnixMilli()
	for i := int64(0); i < 125; i++ {
		require.NoError(t, PersistServerSnapshot(11, uuid, sampleAt(base+i*1000)))
	}
	result, err := QueryServerSnapshot(11, uuid, 1)
	require.NoError(t, err)
	require.NotNil(t, result)
	require.Len(t, result.Recent["cpu"], 61)
	require.Equal(t, base+124000, result.LastReportAt)
	require.Equal(t, float64(25), result.Metrics["disk_percent"])
	require.Equal(t, float64(25), result.Metrics["memory_percent"])
	require.Equal(t, float64(50), result.Metrics["swap_percent"])
	require.Equal(t, "ubuntu", result.Snapshot.Host.Platform)
	require.Equal(t, "JP", result.Snapshot.CountryCode)
	// Read through a fresh independent database handle, not an in-memory cache.
	var databases []struct {
		Name string
		File string
	}
	require.NoError(t, DB.Raw("PRAGMA database_list").Scan(&databases).Error)
	previous := DB
	reopened, err := gorm.Open(openSQLiteDialector(databases[0].File), &gorm.Config{})
	require.NoError(t, err)
	DB = reopened
	again, err := QueryServerSnapshot(11, uuid, 1)
	require.NoError(t, err)
	require.Equal(t, result, again)
	sqlDB, _ := reopened.DB()
	require.NoError(t, sqlDB.Close())
	DB = previous
	// A new report after a long outage starts a new one-minute window.
	require.NoError(t, PersistServerSnapshot(11, uuid, sampleAt(base+86400000)))
	result, err = QueryServerSnapshot(11, uuid, 1)
	require.NoError(t, err)
	require.Len(t, result.Recent["cpu"], 1)
}
func TestSnapshotCoalescesSecondsAndRejectsStaleReports(t *testing.T) {
	uuid, _ := snapshotFixture(t)
	a := sampleAt(100001)
	require.NoError(t, PersistServerSnapshot(11, uuid, a))
	a.At = 100999
	a.State.CPU = 99
	require.NoError(t, PersistServerSnapshot(11, uuid, a))
	a.At = 100500
	a.State.CPU = 1
	require.NoError(t, PersistServerSnapshot(11, uuid, a))
	result, err := QueryServerSnapshot(11, uuid, 1)
	require.NoError(t, err)
	require.Len(t, result.Recent["cpu"], 1)
	require.Equal(t, float64(99), result.Metrics["cpu"])
	result, err = QueryServerSnapshot(11, "wrong-uuid", 1)
	require.NoError(t, err)
	require.Nil(t, result)
}
func TestSnapshotDeletionAndReusedIDCannotInheritHistory(t *testing.T) {
	uuid, _ := snapshotFixture(t)
	require.NoError(t, PersistServerSnapshot(11, uuid, sampleAt(100000)))
	require.NoError(t, PermanentlyDeleteServers([]uint64{11}))
	require.NoError(t, PersistServerSnapshot(11, uuid, sampleAt(101000)))
	var count int64
	require.NoError(t, DB.Model(&model.ServerSnapshot{}).Count(&count).Error)
	require.Zero(t, count)
	require.NoError(t, DB.Create(&model.Server{Common: model.Common{ID: 11}, UUID: "replacement"}).Error)
	require.NoError(t, PersistServerSnapshot(11, uuid, sampleAt(102000)))
	require.NoError(t, DB.Model(&model.ServerSnapshot{}).Count(&count).Error)
	require.Zero(t, count)
	require.NoError(t, PersistServerSnapshot(11, "replacement", sampleAt(103000)))
	got, err := QueryServerSnapshot(11, "replacement", 1)
	require.NoError(t, err)
	require.EqualValues(t, 103000, got.LastReportAt)
}
func TestSnapshotConcurrentFleetWrites(t *testing.T) {
	previous := DB
	db, err := gorm.Open(openSQLiteDialector(filepath.Join(t.TempDir(), "load.sqlite")), &gorm.Config{})
	require.NoError(t, err)
	DB = db
	sqlDB, _ := db.DB()
	t.Cleanup(func() { sqlDB.Close(); DB = previous })
	require.NoError(t, DB.AutoMigrate(&model.Server{}, &model.ServerSnapshot{}))
	for i := 1; i <= 118; i++ {
		require.NoError(t, DB.Create(&model.Server{Common: model.Common{ID: uint64(i)}, UUID: fmt.Sprint(i)}).Error)
	}
	started := time.Now()
	var wg sync.WaitGroup
	errs := make(chan error, 118)
	for i := 1; i <= 118; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for j := 0; j < 5; j++ {
				if err := PersistServerSnapshot(uint64(id), fmt.Sprint(id), sampleAt(100000+int64(j)*1000)); err != nil {
					errs <- err
					return
				}
			}
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		require.NoError(t, err)
	}
	var count int64
	require.NoError(t, DB.Model(&model.ServerSnapshot{}).Count(&count).Error)
	require.EqualValues(t, 590, count)
	t.Logf("118 concurrent servers / 590 persisted samples: %s", time.Since(started))
}
