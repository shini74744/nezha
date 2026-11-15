//go:build linux || darwin || freebsd

package backupspace

import (
	"fmt"
	"golang.org/x/sys/unix"
)

func Check(path string, reserve uint64) error {
	var stat unix.Statfs_t
	if err := unix.Statfs(path, &stat); err != nil {
		return fmt.Errorf("无法检查备份磁盘空间: %w", err)
	}
	available := uint64(stat.Bavail) * uint64(stat.Bsize)
	if available < reserve {
		return fmt.Errorf("磁盘剩余空间不足：剩余 %.0f MiB，至少需保留 %.0f MiB", float64(available)/(1024*1024), float64(reserve)/(1024*1024))
	}
	return nil
}
