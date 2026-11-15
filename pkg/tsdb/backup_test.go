//go:build !windows

package tsdb

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/nezhahq/nezha/pkg/panelbackup"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestOnlineBackupRestoresHistoryAndKeepsIngestionEnabled(t *testing.T) {
	root := t.TempDir()
	config := &Config{DataPath: filepath.Join(root, "tsdb"), RetentionDays: 1, MinFreeDiskSpaceGB: 0.001, DedupInterval: time.Millisecond}
	db, err := Open(config)
	require.NoError(t, err)
	defer db.Close()
	at := time.Now().Add(-time.Minute)
	require.NoError(t, db.WriteServerMetrics(&ServerMetrics{ServerID: 1, Timestamp: at, CPU: 42}))
	require.NoError(t, db.WriteServiceMetrics(&ServiceMetrics{ServiceID: 7, ServerID: 1, Timestamp: at, Delay: 123, Successful: true}))
	sqlPath := filepath.Join(root, "sqlite.db")
	sqlDB, err := gorm.Open(sqlite.Open(sqlPath), &gorm.Config{})
	require.NoError(t, err)
	connection, err := sqlDB.DB()
	require.NoError(t, err)
	defer connection.Close()
	require.NoError(t, sqlDB.Exec("CREATE TABLE fixture (id INTEGER)").Error)
	cfg := filepath.Join(root, "config.yaml")
	require.NoError(t, os.WriteFile(cfg, []byte("fixture: true"), 0600))
	snapshot, err := panelbackup.Prepare(context.Background(), panelbackup.Source{Database: sqlPath, Config: cfg, DataDir: root, TSDBDir: config.DataPath, TSDBSnapshot: db.CreateBackupSnapshot}, func(string) {})
	require.NoError(t, err)
	require.False(t, db.WritesPaused())
	require.NoError(t, db.WriteServerMetrics(&ServerMetrics{ServerID: 2, Timestamp: at, CPU: 88}))
	db.Flush()
	live, err := db.QueryServerMetrics(2, MetricServerCPU, Period1Day)
	require.NoError(t, err)
	require.NotEmpty(t, live)
	var archive bytes.Buffer
	require.NoError(t, snapshot.Write(context.Background(), &archive, func(int64) {}))
	require.NoError(t, snapshot.Close())
	entries, err := os.ReadDir(filepath.Join(config.DataPath, "snapshots"))
	require.NoError(t, err)
	require.Empty(t, entries)
	restored := t.TempDir()
	gz, err := gzip.NewReader(bytes.NewReader(archive.Bytes()))
	require.NoError(t, err)
	defer gz.Close()
	tr := tar.NewReader(gz)
	for {
		h, e := tr.Next()
		if e == io.EOF {
			break
		}
		require.NoError(t, e)
		p := filepath.Join(restored, filepath.FromSlash(h.Name))
		require.NoError(t, os.MkdirAll(filepath.Dir(p), 0700))
		body, e := io.ReadAll(tr)
		require.NoError(t, e)
		require.NoError(t, os.WriteFile(p, body, 0600))
	}
	restoredDB, err := Open(&Config{DataPath: filepath.Join(restored, "data", "tsdb"), RetentionDays: 1, MinFreeDiskSpaceGB: 0.001, DedupInterval: time.Millisecond})
	require.NoError(t, err)
	defer restoredDB.Close()
	metrics, err := restoredDB.QueryServerMetrics(1, MetricServerCPU, Period1Day)
	require.NoError(t, err)
	require.NotEmpty(t, metrics)
	require.InDelta(t, 42, metrics[len(metrics)-1].Value, 0.01)
	future, err := restoredDB.QueryServerMetrics(2, MetricServerCPU, Period1Day)
	require.NoError(t, err)
	require.Empty(t, future)
	services, err := restoredDB.QueryServiceHistoryByServerID(1, Period1Day)
	require.NoError(t, err)
	require.Contains(t, services, uint64(7))
}
