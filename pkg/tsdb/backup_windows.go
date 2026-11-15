//go:build windows

package tsdb

import "errors"

// Windows cannot unlink the storage engine's live mapped snapshot hard links.
// Its cleanup exits the process rather than returning an error, so reject the
// operation before creating a snapshot or changing the running storage.
func (db *TSDB) CreateBackupSnapshot() (string, func() error, error) {
	return "", nil, errors.New("Windows 面板暂不支持历史监控在线备份；请在停止面板后备份完整数据目录")
}
