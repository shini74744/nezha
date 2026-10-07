//go:build linux

package scenario

import (
	"context"
	"errors"
	"net/url"
	"time"

	"github.com/nezhahq/nezha/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Read the disposable Dashboard's audit to distinguish an Agent RPC error from
// the controller's identically worded permission check. The dedicated unprivileged
// Agent performs only this write. Audit persistence is asynchronous in production.
func waitPermissionAgentAudit(ctx context.Context, path string, serverID uint64) (result error) {
	location := url.URL{Scheme: "file", Path: path, RawQuery: "mode=ro"}
	db, err := gorm.Open(sqlite.Open(location.String()), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		return err
	}
	raw, err := db.DB()
	if err != nil {
		return err
	}
	defer func() { result = errors.Join(result, raw.Close()) }()
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	ticker := time.NewTicker(25 * time.Millisecond)
	defer ticker.Stop()
	for {
		var count int64
		err := db.WithContext(ctx).Model(&model.MCPAuditLog{}).
			Where("server_id = ? AND tool = ? AND outcome = ? AND error_code = ? AND error_msg = ?",
				serverID, "fs.write", model.MCPOutcomeAgentError, model.MCPOutcomeAgentError, "permission denied").
			Count(&count).Error
		if err != nil {
			return err
		}
		if count == 1 {
			return nil
		}
		if count > 1 {
			return errors.New("permission Agent audit is not unique")
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}
