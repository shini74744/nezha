//go:build windows

package tsdb

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestWindowsBackupRejectedWithoutChangingHistoryOrIngestion(t *testing.T) {
	config := &Config{DataPath: filepath.Join(t.TempDir(), "tsdb"), RetentionDays: 1, MinFreeDiskSpaceGB: 0.001, DedupInterval: time.Millisecond}
	db, err := Open(config)
	require.NoError(t, err)
	defer db.Close()
	at := time.Now().Add(-time.Minute)
	require.NoError(t, db.WriteServerMetrics(&ServerMetrics{ServerID: 1, Timestamp: at, CPU: 42}))
	directory, cleanup, err := db.CreateBackupSnapshot()
	require.ErrorContains(t, err, "Windows 面板暂不支持历史监控在线备份")
	require.Empty(t, directory)
	require.Nil(t, cleanup)
	require.False(t, db.WritesPaused())
	require.NoError(t, db.WriteServerMetrics(&ServerMetrics{ServerID: 2, Timestamp: at, CPU: 88}))
	db.Flush()
	for id, expected := range map[uint64]float64{1: 42, 2: 88} {
		rows, e := db.QueryServerMetrics(id, MetricServerCPU, Period1Day)
		require.NoError(t, e)
		require.NotEmpty(t, rows)
		require.InDelta(t, expected, rows[len(rows)-1].Value, 0.01)
	}
	entries, err := os.ReadDir(filepath.Join(config.DataPath, "snapshots"))
	if !os.IsNotExist(err) {
		require.NoError(t, err)
		require.Empty(t, entries)
	}
}
