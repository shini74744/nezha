package singleton

import (
	"sync"
	"testing"
	"time"

	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

const releaseFixtureUUID = "aa555555-1111-4111-8111-111111111111"

func seedReleaseFixture(t *testing.T) model.ServerDeletionTombstone {
	t.Helper()
	row := model.ServerDeletionTombstone{UUID: releaseFixtureUUID, Name: "deleted fixture",
		OriginalID: 47, DeletedByID: 3, DeletedByName: "deleter", CreatedAt: time.Now().Add(-time.Hour),
		LastIP: "192.0.2.40", FirstReportAt: 1, LastReportAt: 2, ReportCount: 7}
	require.NoError(t, DB.Create(&row).Error)
	require.NoError(t, initDeletedServerUUIDs())
	return row
}

func TestReleaseUUIDPreservesHistoryAndSurvivesReload(t *testing.T) {
	setupPermanentDeleteTest(t)
	before := seedReleaseFixture(t)
	require.True(t, IsDeletedServerUUID(before.UUID))
	row, err := ReleaseDeletedServerUUID(before.UUID, before.BlockVersion, model.ServerOperationActor{ID: 8, Name: "admin", Source: "web"})
	require.NoError(t, err)
	require.False(t, IsDeletedServerUUID(before.UUID))
	require.Positive(t, row.ReleasedAt)
	require.EqualValues(t, 8, row.ReleasedByID)
	require.Equal(t, "admin", row.ReleasedByName)
	require.True(t, before.CreatedAt.Equal(row.CreatedAt))
	require.Equal(t, before.ReportCount, row.ReportCount)
	require.Equal(t, before.OriginalID, row.OriginalID)
	require.NoError(t, initDeletedServerUUIDs())
	require.False(t, IsDeletedServerUUID(before.UUID), "restart must not re-block a released UUID")
	RecordDeletedAgentReport(before.UUID, "192.0.2.41")
	var saved model.ServerDeletionTombstone
	require.NoError(t, DB.First(&saved, "uuid = ?", before.UUID).Error)
	require.EqualValues(t, 7, saved.ReportCount)
	var logs []model.ServerOperationLog
	require.NoError(t, DB.Find(&logs).Error)
	require.Len(t, logs, 1)
	require.Equal(t, "release_uuid", logs[0].Action)
	require.Equal(t, before.UUID, logs[0].ServerUUID)
	require.EqualValues(t, 8, logs[0].ActorID)
	require.Equal(t, "uuid_block", logs[0].Changes[0].Field)
	var nodes int64
	require.NoError(t, DB.Model(&model.Server{}).Count(&nodes).Error)
	require.Zero(t, nodes, "release is not restoration or registration")

	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := ReleaseDeletedServerUUID(before.UUID, 1, model.ServerOperationActor{})
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		require.NoError(t, err)
	}
	var count int64
	require.NoError(t, DB.Model(&model.ServerOperationLog{}).Count(&count).Error)
	require.EqualValues(t, 1, count, "retries must not create duplicate audit entries")
}

func TestReleaseUUIDAuditFailureRollsBackAndKeepsBlocked(t *testing.T) {
	setupPermanentDeleteTest(t)
	row := seedReleaseFixture(t)
	require.NoError(t, DB.Exec("CREATE TRIGGER reject_release_audit BEFORE INSERT ON server_operation_logs BEGIN SELECT RAISE(ABORT, 'fixture audit failure'); END").Error)
	_, err := ReleaseDeletedServerUUID(row.UUID, 1, model.ServerOperationActor{})
	require.Error(t, err)
	require.True(t, IsDeletedServerUUID(row.UUID))
	require.NoError(t, DB.First(&row, "uuid = ?", row.UUID).Error)
	require.Zero(t, row.ReleasedAt)
	for _, value := range []string{"", "bad", "bb555555-1111-4111-8111-111111111111"} {
		_, err = ReleaseDeletedServerUUID(value, 1, model.ServerOperationActor{})
		require.Error(t, err)
	}
	_, err = ReleaseDeletedServerUUID(row.UUID, 0, model.ServerOperationActor{})
	require.Error(t, err)
}

func TestDeleteAfterReleaseReblocksWithNewVersion(t *testing.T) {
	setupPermanentDeleteTest(t)
	old := seedReleaseFixture(t)
	_, err := ReleaseDeletedServerUUID(old.UUID, 1, model.ServerOperationActor{})
	require.NoError(t, err)
	ServerMutationMu.Lock()
	server, err := CreateServerWithLowestAvailableID(1, old.UUID, "registered again")
	ServerMutationMu.Unlock()
	require.NoError(t, err)
	model.InitServer(server)
	ServerShared.Update(server, server.UUID)
	require.NoError(t, PermanentlyDeleteServersMatching([]uint64{server.ID}, nil, model.ServerOperationActor{ID: 9, Name: "new deleter"}))
	require.True(t, IsDeletedServerUUID(old.UUID))
	var row model.ServerDeletionTombstone
	require.NoError(t, DB.First(&row, "uuid = ?", old.UUID).Error)
	require.EqualValues(t, 2, row.BlockVersion)
	require.Zero(t, row.ReleasedAt)
	require.Zero(t, row.ReleasedByID)
	require.Empty(t, row.ReleasedByName)
	require.Zero(t, row.ReportCount)
	require.Equal(t, server.ID, row.OriginalID)
	require.Equal(t, "new deleter", row.DeletedByName)
	_, err = ReleaseDeletedServerUUID(old.UUID, 1, model.ServerOperationActor{})
	require.ErrorContains(t, err, "封禁记录已变化")
	require.True(t, IsDeletedServerUUID(old.UUID), "stale confirmation cannot release a newer deletion")
	require.NoError(t, initDeletedServerUUIDs())
	require.True(t, IsDeletedServerUUID(old.UUID))
}

func TestLegacyDeletionMigrationDefaultsToBlocked(t *testing.T) {
	setupPermanentDeleteTest(t)
	require.NoError(t, DB.Migrator().DropTable(&model.ServerDeletionTombstone{}))
	require.NoError(t, DB.Exec("CREATE TABLE server_deletion_tombstones (uuid TEXT PRIMARY KEY, name TEXT, created_at datetime, report_count INTEGER DEFAULT 0)").Error)
	require.NoError(t, DB.Exec("INSERT INTO server_deletion_tombstones (uuid,name,report_count) VALUES (?, 'legacy', 4)", releaseFixtureUUID).Error)
	require.NoError(t, DB.AutoMigrate(&model.ServerDeletionTombstone{}))
	require.NoError(t, initDeletedServerUUIDs())
	require.True(t, IsDeletedServerUUID(releaseFixtureUUID))
	var row model.ServerDeletionTombstone
	require.NoError(t, DB.First(&row, "uuid = ?", releaseFixtureUUID).Error)
	require.EqualValues(t, 1, row.BlockVersion)
	require.Zero(t, row.ReleasedAt)
	require.EqualValues(t, 4, row.ReportCount)
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error { return tx.Model(&row).Update("released_at", 1).Error }))
	require.NoError(t, initDeletedServerUUIDs())
	require.False(t, IsDeletedServerUUID(releaseFixtureUUID))
}
