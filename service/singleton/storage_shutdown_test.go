package singleton

import (
	"testing"

	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/tsdb"
	"github.com/stretchr/testify/require"
)

func TestCloseTSDBDoesNotConfirmPersistenceWhenPaused(t *testing.T) {
	previous := TSDBShared
	db, err := tsdb.Open(&tsdb.Config{DataPath: t.TempDir(), MaxMemoryMB: 32, MinFreeDiskSpaceGB: 1})
	require.NoError(t, err)
	TSDBShared = db
	t.Cleanup(func() { _ = db.Close(); TSDBShared = previous })
	require.NoError(t, db.PauseWritesForMaintenance())
	require.ErrorContains(t, CloseTSDB(), "complete persistence cannot be confirmed")
	require.True(t, db.IsClosed())
}

func TestRecordTransferHourlyUsageReturnsWriteFailure(t *testing.T) {
	ss := shutdownSentinelFixture(t)
	ss.Close()
	reporter := &model.Server{Common: model.Common{ID: 1}, State: &model.HostState{NetInTransfer: 123, NetOutTransfer: 456}}
	require.NoError(t, DB.Migrator().DropTable(&model.Transfer{}))
	require.Error(t, RecordTransferHourlyUsage(reporter))
}
