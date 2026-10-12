package controller

import (
	"testing"

	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestServerIDReassignmentMovesOnlyMatchingTerminalIdentities(t *testing.T) {
	db := newServerRekeyTestDB(t)
	seedServerRekeyRecords(t, db)
	require.NoError(t, db.AutoMigrate(&model.TerminalSession{}, &model.TerminalSessionEvent{}))
	for index, uuid := range []string{"00000000-0000-0000-0000-000000000063", "retired-machine"} {
		require.NoError(t, db.Create(&model.TerminalSession{Common: model.Common{ID: uint64(index + 1)}, ServerID: 63, ServerUUID: uuid, Kind: "tmux", Name: "keep"}).Error)
	}
	history := model.ServerOperationLog{ServerID: 63, ServerUUID: "00000000-0000-0000-0000-000000000063", Action: "inventory_change"}
	require.NoError(t, db.Create(&history).Error)
	require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
		return reassignServerIDsInDB(tx, []uint64{63, 47}, map[uint64]uint64{63: 1, 47: 2})
	}))
	var sessions []model.TerminalSession
	require.NoError(t, db.Order("id").Find(&sessions).Error)
	require.Equal(t, uint64(1), sessions[0].ServerID)
	require.Equal(t, uint64(63), sessions[1].ServerID)
	var got model.ServerOperationLog
	require.NoError(t, db.First(&got, history.ID).Error)
	require.Equal(t, uint64(63), got.ServerID, "historical IDs must remain snapshots")
}
