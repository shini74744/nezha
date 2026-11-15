//go:build !windows

package tsdb

import (
	"fmt"
	"path/filepath"
)

// CreateBackupSnapshot leaves ingestion enabled. The storage engine flushes
// immutable parts and pins them with hard links until the returned cleanup runs.
func (db *TSDB) CreateBackupSnapshot() (directory string, cleanup func() error, err error) {
	db.mu.Lock()
	defer db.mu.Unlock()
	if db.closed || db.maintenancePaused.Load() {
		return "", nil, fmt.Errorf("历史监控存储正在维护，请稍后重试")
	}
	defer func() {
		if v := recover(); v != nil {
			directory = ""
			cleanup = nil
			err = fmt.Errorf("历史监控快照创建失败: %v", v)
		}
	}()
	if db.writer != nil {
		db.writer.flush()
	}
	db.storage.DebugFlush()
	name := db.storage.MustCreateSnapshot()
	directory = filepath.Join(db.config.DataPath, "snapshots", name)
	cleanup = func() (err error) {
		db.mu.Lock()
		defer db.mu.Unlock()
		if db.closed {
			return fmt.Errorf("历史监控存储已关闭，快照等待清理")
		}
		defer func() {
			if v := recover(); v != nil {
				err = fmt.Errorf("历史监控快照清理失败: %v", v)
			}
		}()
		return db.storage.DeleteSnapshot(name)
	}
	return directory, cleanup, nil
}
