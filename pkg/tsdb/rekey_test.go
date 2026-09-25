package tsdb

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestRemapServerIDsPreservesServerAndServiceHistory(t *testing.T) {
	config := &Config{
		DataPath:           filepath.Join(t.TempDir(), "tsdb"),
		RetentionDays:      1,
		MinFreeDiskSpaceGB: 0.001,
		DedupInterval:      time.Millisecond,
	}
	db, err := Open(config)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	at := time.Now().Add(-time.Minute)
	// ID 1 is an orphaned historical label. Reassigning server 10 to ID 1
	// must replace it, not merge unrelated history into the new server.
	require.NoError(t, db.WriteServerMetrics(&ServerMetrics{
		ServerID: 1, Timestamp: at.Add(-time.Second), CPU: 99,
	}))
	require.NoError(t, db.WriteServerMetrics(&ServerMetrics{
		ServerID: 10, Timestamp: at, CPU: 11,
	}))
	require.NoError(t, db.WriteServerMetrics(&ServerMetrics{
		ServerID: 20, Timestamp: at, CPU: 22,
	}))
	require.NoError(t, db.WriteServiceMetrics(&ServiceMetrics{
		ServiceID: 7, ServerID: 10, Timestamp: at, Delay: 33, Successful: true,
	}))
	require.NoError(t, db.WriteServiceMetrics(&ServiceMetrics{
		ServiceID: 7, ServerID: 20, Timestamp: at, Delay: 44, Successful: false,
	}))
	db.Flush()
	require.NoError(t, db.PauseWritesForMaintenance())
	require.True(t, db.WritesPaused())
	snapshot, err := db.CreateMaintenanceSnapshot()
	require.NoError(t, err)
	require.NotEmpty(t, snapshot)
	_, err = os.Stat(filepath.Join(config.DataPath, "snapshots", snapshot))
	require.NoError(t, err)
	require.NoError(t, db.RemapServerIDs(map[uint64]uint64{10: 1, 20: 2}))
	db.ResumeWritesAfterMaintenance()
	require.False(t, db.WritesPaused())

	serverOne, err := db.QueryServerMetrics(1, MetricServerCPU, Period1Day)
	require.NoError(t, err)
	require.NotEmpty(t, serverOne)
	for _, sample := range serverOne {
		require.NotEqual(t, float64(99), sample.Value)
	}
	require.InDelta(t, 11, serverOne[len(serverOne)-1].Value, 0.01)

	serverTwo, err := db.QueryServerMetrics(2, MetricServerCPU, Period1Day)
	require.NoError(t, err)
	require.NotEmpty(t, serverTwo)
	require.InDelta(t, 22, serverTwo[len(serverTwo)-1].Value, 0.01)

	old, err := db.QueryServerMetrics(10, MetricServerCPU, Period1Day)
	require.NoError(t, err)
	require.Empty(t, old)

	serviceOne, err := db.QueryServiceHistoryByServerID(1, Period1Day)
	require.NoError(t, err)
	require.Contains(t, serviceOne, uint64(7))

	serviceTwo, err := db.QueryServiceHistoryByServerID(2, Period1Day)
	require.NoError(t, err)
	require.Contains(t, serviceTwo, uint64(7))
}

func TestDeleteServerIDsRemovesOnlyTargetServerSeries(t *testing.T) {
	config := &Config{
		DataPath:           filepath.Join(t.TempDir(), "tsdb"),
		RetentionDays:      1,
		MinFreeDiskSpaceGB: 0.001,
		DedupInterval:      time.Millisecond,
	}
	db, err := Open(config)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	at := time.Now().Add(-time.Minute)
	require.NoError(t, db.WriteServerMetrics(&ServerMetrics{
		ServerID: 11, Timestamp: at, CPU: 11,
	}))
	require.NoError(t, db.WriteServiceMetrics(&ServiceMetrics{
		ServiceID: 7, ServerID: 11, Timestamp: at, Delay: 11, Successful: true,
	}))
	require.NoError(t, db.WriteServerMetrics(&ServerMetrics{
		ServerID: 12, Timestamp: at, CPU: 12,
	}))
	require.NoError(t, db.WriteServiceMetrics(&ServiceMetrics{
		ServiceID: 7, ServerID: 12, Timestamp: at, Delay: 12, Successful: true,
	}))
	db.Flush()

	require.NoError(t, db.DeleteServerIDs([]uint64{11}))
	require.False(t, db.WritesPaused())

	deletedMetrics, err := db.QueryServerMetrics(11, MetricServerCPU, Period1Day)
	require.NoError(t, err)
	require.Empty(t, deletedMetrics)
	deletedServices, err := db.QueryServiceHistoryByServerID(11, Period1Day)
	require.NoError(t, err)
	require.Empty(t, deletedServices)

	keptMetrics, err := db.QueryServerMetrics(12, MetricServerCPU, Period1Day)
	require.NoError(t, err)
	require.NotEmpty(t, keptMetrics)
	keptServices, err := db.QueryServiceHistoryByServerID(12, Period1Day)
	require.NoError(t, err)
	require.Contains(t, keptServices, uint64(7))
}
