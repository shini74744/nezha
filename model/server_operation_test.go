package model

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func operationTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&Server{}, &ServerOperationLog{}, &ServerGroup{}, &ServerGroupServer{}))
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	return db
}

func TestServerOperationDiffRedactsFreeFormSecrets(t *testing.T) {
	db := operationTestDB(t)
	s := &Server{Common: Common{ID: 11, UserID: 1}, UUID: "node-a", Name: "A", Note: "private-before", PublicNote: "token=before"}
	require.NoError(t, db.Create(s).Error)
	actor := ServerOperationActor{ID: 9, Name: "operator", Source: "web"}
	require.NoError(t, WithServerOperation(db, actor, "edit", []uint64{11}, func(tx *gorm.DB) error {
		return tx.Model(&Server{}).Where("id = ?", 11).Updates(map[string]any{"name": "B", "note": "password=secret", "public_note": "https://example.test/?token=secret", "hide_for_guest": true}).Error
	}))
	var row ServerOperationLog
	require.NoError(t, db.First(&row).Error)
	require.Equal(t, actor.ID, row.ActorID)
	require.Equal(t, "node-a", row.ServerUUID)
	require.Contains(t, row.Changes, ServerOperationChange{"name", "A", "B"})
	require.Contains(t, row.Changes, ServerOperationChange{"hide_for_guest", "false", "true"})
	raw, err := json.Marshal(row)
	require.NoError(t, err)
	require.NotContains(t, string(raw), "secret")
	require.NotContains(t, string(raw), "private-before")
	require.NotContains(t, string(raw), "token=")
	require.Len(t, row.Changes, 4)
	require.NoError(t, WithServerOperation(db, actor, "edit", []uint64{11}, func(tx *gorm.DB) error { return nil }))
	var count int64
	require.NoError(t, db.Model(&ServerOperationLog{}).Count(&count).Error)
	require.EqualValues(t, 1, count, "no-op changes should not produce history noise")
}

func TestServerOperationIdentitySurvivesRekeyDeletionAndReuse(t *testing.T) {
	db := operationTestDB(t)
	s := &Server{Common: Common{ID: 11}, UUID: "node-a", Name: "A"}
	require.NoError(t, db.Create(s).Error)
	require.NoError(t, WithServerOperation(db, ServerOperationActor{}, "reassign_ids", []uint64{11}, func(tx *gorm.DB) error {
		return tx.Model(&Server{}).Where("id = ?", 11).Update("id", 2).Error
	}))
	require.NoError(t, WithServerOperation(db, ServerOperationActor{}, "delete", []uint64{2}, func(tx *gorm.DB) error {
		return tx.Delete(&Server{}, 2).Error
	}))
	require.NoError(t, db.Create(&Server{Common: Common{ID: 2}, UUID: "node-b", Name: "new node"}).Error)
	var rows []ServerOperationLog
	require.NoError(t, db.Order("id ASC").Find(&rows).Error)
	require.Len(t, rows, 2)
	require.EqualValues(t, 11, rows[0].PreviousID)
	require.EqualValues(t, 2, rows[0].ServerID)
	require.Equal(t, "node-a", rows[0].ServerUUID)
	require.Equal(t, "node-a", rows[1].ServerUUID)
	require.Contains(t, rows[0].Changes, ServerOperationChange{"id", "11", "2"})
	require.Equal(t, "status", rows[1].Changes[0].Field)
}

func TestServerOperationAndMutationRollBackTogether(t *testing.T) {
	db := operationTestDB(t)
	require.NoError(t, db.Create(&Server{Common: Common{ID: 1}, UUID: "a", Name: "A"}).Error)
	stop := errors.New("mutation failed")
	require.ErrorIs(t, WithServerOperation(db, ServerOperationActor{}, "edit", []uint64{1}, func(tx *gorm.DB) error {
		require.NoError(t, tx.Model(&Server{}).Where("id = ?", 1).Update("name", "B").Error)
		return stop
	}), stop)
	var count int64
	require.NoError(t, db.Model(&ServerOperationLog{}).Count(&count).Error)
	require.Zero(t, count)
	require.NoError(t, db.Migrator().DropTable(&ServerOperationLog{}))
	require.Error(t, WithServerOperation(db, ServerOperationActor{}, "edit", []uint64{1}, func(tx *gorm.DB) error {
		return tx.Model(&Server{}).Where("id = ?", 1).Update("name", "C").Error
	}))
	var server Server
	require.NoError(t, db.First(&server, 1).Error)
	require.Equal(t, "A", server.Name, "audit write failure must roll back persisted edits")
}

func TestServerOperationGroupMembershipDiff(t *testing.T) {
	db := operationTestDB(t)
	require.NoError(t, db.Create(&Server{Common: Common{ID: 1}, UUID: "a", Name: "A"}).Error)
	require.NoError(t, db.Create(&ServerGroup{Common: Common{ID: 3}, Name: "Asia"}).Error)
	require.NoError(t, WithServerOperation(db, ServerOperationActor{}, "group", nil, func(tx *gorm.DB) error {
		return tx.Create(&ServerGroupServer{ServerId: 1, ServerGroupId: 3}).Error
	}))
	var row ServerOperationLog
	require.NoError(t, db.First(&row).Error)
	require.Equal(t, []ServerOperationChange{{"groups", "", "#3 Asia"}}, row.Changes)
}
