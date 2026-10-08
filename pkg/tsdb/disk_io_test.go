package tsdb

import (
	"github.com/stretchr/testify/require"
	"path/filepath"
	"testing"
	"time"
)

func TestDiskIOOnlyPersistsAvailableSamples(t *testing.T) {
	db, err := Open(&Config{DataPath: filepath.Join(t.TempDir(), "tsdb"), RetentionDays: 1, MinFreeDiskSpaceGB: 1, DedupInterval: time.Second})
	require.NoError(t, err)
	defer db.Close()
	at := time.Now().Add(-time.Minute)
	require.NoError(t, db.WriteServerMetrics(&ServerMetrics{ServerID: 1, Timestamp: at, DiskReadSpeed: 999, DiskWriteSpeed: 999}))
	require.NoError(t, db.WriteServerMetrics(&ServerMetrics{ServerID: 2, Timestamp: at, DiskIOAvailable: true, DiskReadSpeed: 4096, DiskWriteSpeed: 8192}))
	require.NoError(t, db.WriteBatchServerMetrics([]*ServerMetrics{{ServerID: 3, Timestamp: at, DiskIOAvailable: true}, {ServerID: 4, Timestamp: at, DiskReadSpeed: 999}}))
	db.Flush()
	for _, metric := range []MetricType{MetricServerDiskReadSpeed, MetricServerDiskWriteSpeed} {
		for _, id := range []uint64{1, 4} {
			points, err := db.QueryServerMetrics(id, metric, Period1Day)
			require.NoError(t, err)
			require.Empty(t, points)
		}
		points, err := db.QueryServerMetrics(2, metric, Period1Day)
		require.NoError(t, err)
		require.NotEmpty(t, points)
		expected := float64(4096)
		if metric == MetricServerDiskWriteSpeed {
			expected = 8192
		}
		require.Equal(t, expected, points[0].Value)
		idle, err := db.QueryServerMetrics(3, metric, Period1Day)
		require.NoError(t, err)
		require.NotEmpty(t, idle)
		require.Zero(t, idle[0].Value)
	}
}
