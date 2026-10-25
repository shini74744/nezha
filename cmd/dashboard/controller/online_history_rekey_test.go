package controller

import (
	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"testing"
	"time"
)

func TestOnlineHistoryFollowsServerIDReassignment(t *testing.T) {
	db := newServerRekeyTestDB(t)
	seedServerRekeyRecords(t, db)
	require.NoError(t, db.AutoMigrate(&model.OnlineSession{}, &model.OnlineHistoryCoverage{}))
	now := time.Now().UTC()
	for _, id := range []uint64{47, 63} {
		require.NoError(t, db.Create(&model.OnlineSession{ServerID: id, StartedAt: now.Add(-time.Duration(id) * time.Hour), LastActiveAt: now, Ongoing: true}).Error)
		require.NoError(t, db.Create(&model.OnlineHistoryCoverage{ServerID: id, StartedAt: now.Add(-time.Duration(id) * time.Hour)}).Error)
	}
	require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
		return reassignServerIDsInDB(tx, []uint64{63, 47}, map[uint64]uint64{63: 1, 47: 2})
	}))
	var sessions []model.OnlineSession
	require.NoError(t, db.Order("server_id").Find(&sessions).Error)
	require.Len(t, sessions, 2)
	require.Equal(t, uint64(1), sessions[0].ServerID)
	require.True(t, sessions[0].StartedAt.Equal(now.Add(-63*time.Hour)))
	var coverage model.OnlineHistoryCoverage
	require.NoError(t, db.First(&coverage, "server_id = ?", 1).Error)
	require.True(t, coverage.StartedAt.Equal(sessions[0].StartedAt))
}
