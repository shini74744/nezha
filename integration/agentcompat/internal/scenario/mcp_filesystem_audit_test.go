//go:build linux

package scenario

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestPermissionAgentAuditRequiresActualAgentFailure(t *testing.T) {
	for _, tc := range []struct {
		name     string
		outcome  string
		serverID uint64
		pass     bool
	}{
		{"agent", model.MCPOutcomeAgentError, 7, true},
		{"controller", model.MCPOutcomePermDenied, 7, false},
		{"different-agent", model.MCPOutcomeAgentError, 8, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "sqlite.db")
			db, err := gorm.Open(sqlite.Open(path), &gorm.Config{})
			require.NoError(t, err)
			raw, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, raw.Close()) })
			require.NoError(t, db.AutoMigrate(&model.MCPAuditLog{}))
			require.NoError(t, db.Create(&model.MCPAuditLog{ServerID: tc.serverID, Tool: "fs.write", Outcome: tc.outcome, ErrorCode: tc.outcome, ErrorMsg: "permission denied"}).Error)
			ctx, cancel := context.WithTimeout(t.Context(), 100*time.Millisecond)
			defer cancel()
			err = waitPermissionAgentAudit(ctx, path, 7)
			if tc.pass {
				require.NoError(t, err)
			} else {
				require.ErrorIs(t, err, context.DeadlineExceeded)
			}
		})
	}
}

func TestPermissionAgentAuditDoesNotCreateMissingDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "missing.db")
	require.Error(t, waitPermissionAgentAudit(t.Context(), path, 7))
	require.NoFileExists(t, path)
}
