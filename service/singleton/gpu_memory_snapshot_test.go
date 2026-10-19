package singleton

import (
	"testing"
	"time"

	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestGPUMemoryPersistOfflineRestartAndResume(t *testing.T) {
	uuid, _ := snapshotFixture(t)
	// An old last report is still the frozen snapshot, not wall-clock expired.
	at := time.Now().Add(-90 * 24 * time.Hour).UnixMilli()
	sample := sampleAt(at)
	sample.Host.GPU = []string{"T4", "A10"}
	sample.State.GPU = []float64{33, 55}
	sample.State.GPUs = []model.GPUStat{
		{Utilization: 33, MemoryUsed: 2048, MemoryTotal: 8192},
		{Utilization: 55, MemoryTotal: 24576},
	}
	require.NoError(t, PersistServerSnapshot(11, uuid, sample))
	sample.State.GPUs[0].MemoryUsed = 4096
	first, err := QueryServerSnapshot(11, uuid, 1)
	require.NoError(t, err)
	require.EqualValues(t, 2048, first.Snapshot.State.GPUs[0].MemoryUsed)
	require.EqualValues(t, 0, first.Snapshot.State.GPUs[1].MemoryUsed)
	require.Equal(t, at, first.LastReportAt)
	var databases []struct {
		Name string
		File string
	}
	require.NoError(t, DB.Raw("PRAGMA database_list").Scan(&databases).Error)
	previous := DB
	reopened, err := gorm.Open(openSQLiteDialector(databases[0].File), &gorm.Config{})
	require.NoError(t, err)
	DB = reopened
	sqlDB, err := reopened.DB()
	require.NoError(t, err)
	t.Cleanup(func() { DB = previous; _ = sqlDB.Close() })
	again, err := QueryServerSnapshot(11, uuid, 1)
	require.NoError(t, err)
	require.Equal(t, first, again)
	stale := sample
	stale.At = at - 1000
	require.NoError(t, PersistServerSnapshot(11, uuid, stale))
	frozen, err := QueryServerSnapshot(11, uuid, 1)
	require.NoError(t, err)
	// An older second may backfill the minute curve, but must never replace
	// the latest snapshot or its timestamp.
	require.Equal(t, first.Snapshot, frozen.Snapshot)
	require.Equal(t, first.LastReportAt, frozen.LastReportAt)
	require.Equal(t, first.Metrics, frozen.Metrics)
	// A genuine new report replaces frozen values on reconnect.
	sample.At = at + 100000
	require.NoError(t, PersistServerSnapshot(11, uuid, sample))
	resumed, err := QueryServerSnapshot(11, uuid, 1)
	require.NoError(t, err)
	require.EqualValues(t, 4096, resumed.Snapshot.State.GPUs[0].MemoryUsed)
	require.Equal(t, sample.At, resumed.LastReportAt)
}
