//go:build !windows

package tsdb

import (
	"context"
	"github.com/stretchr/testify/require"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func crashRecoveryConfig(dir string) *Config {
	return &Config{DataPath: filepath.Join(dir, "tsdb"), RetentionDays: 1, MinFreeDiskSpaceGB: 1, MaxMemoryMB: 32, WriteBufferSize: 100000, WriteBufferFlushInterval: time.Hour}
}

// Run only in an isolated subprocess: intentionally leave rows buffered, then
// let the parent kill us without Close. No production paths are ever used.
func TestTSDBCrashRecoveryChild(t *testing.T) {
	dir := os.Getenv("NEZHA_TEST_CRASH_STORAGE")
	if dir == "" {
		t.Skip("subprocess helper")
	}
	db, err := Open(crashRecoveryConfig(dir))
	require.NoError(t, err)
	require.NoError(t, db.WriteServiceMetrics(&ServiceMetrics{ServiceID: 100, ServerID: 1, Timestamp: time.Now().Add(-time.Minute), Delay: 10, Successful: true}))
	db.Flush()
	require.NoError(t, db.WriteServiceMetrics(&ServiceMetrics{ServiceID: 100, ServerID: 1, Timestamp: time.Now(), Delay: 99, Successful: true}))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "ready"), []byte("buffered"), 0600))
	select {}
}

func TestTSDBCrashRecoveryReopensWithUnflushedRows(t *testing.T) {
	dir := t.TempDir()
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	child := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestTSDBCrashRecoveryChild$", "-test.timeout=25s")
	child.Env = append(os.Environ(), "NEZHA_TEST_CRASH_STORAGE="+dir)
	logFile, err := os.Create(filepath.Join(dir, "child.log"))
	require.NoError(t, err)
	defer logFile.Close()
	child.Stdout = logFile
	child.Stderr = logFile
	require.NoError(t, child.Start())
	defer func() {
		if child.ProcessState == nil {
			_ = child.Process.Kill()
			_ = child.Wait()
		}
	}()
	for {
		if _, err = os.Stat(filepath.Join(dir, "ready")); err == nil {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("child did not reach pending-write state")
		case <-time.After(10 * time.Millisecond):
		}
	}
	require.NoError(t, child.Process.Kill())
	require.Error(t, child.Wait(), "child must exit without graceful close")
	db, err := Open(crashRecoveryConfig(dir))
	require.NoError(t, err)
	history, err := db.QueryServiceHistory(100, Period1Day)
	require.NoError(t, err)
	require.NotNil(t, history)
	// Recovery need not retain the deliberately unflushed sample, but must accept
	// and serve new data without deleting/recreating the existing data directory.
	require.NoError(t, db.WriteServiceMetrics(&ServiceMetrics{ServiceID: 200, ServerID: 1, Timestamp: time.Now(), Delay: 20, Successful: true}))
	db.Flush()
	history, err = db.QueryServiceHistory(200, Period1Day)
	require.NoError(t, err)
	require.Len(t, history.Servers, 1)
	require.NoError(t, db.Close())
}
