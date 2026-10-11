package singleton

import (
	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestNewServerAlwaysAppendsAfterReorderingAndIDReuse(t *testing.T) {
	ctx := manualOrderFixture(t)
	require.NoError(t, ServerShared.UpdateManualOrder(ctx, []uint64{9, 7, 2}))
	add := func(uuid string) *model.Server {
		ServerMutationMu.Lock()
		s, err := CreateServerWithLowestAvailableID(1, uuid, "new")
		require.NoError(t, err)
		model.InitServer(s)
		ServerShared.Update(s, s.UUID)
		ServerMutationMu.Unlock()
		return s
	}
	first := add("first-new")
	require.EqualValues(t, 1, first.ID) // Reused small ID must NOT insert at the front.
	require.Equal(t, 0, first.DisplayIndex)
	require.Equal(t, first.ID, ServerShared.GetSortedList()[3].ID)
	// Move previous last to first, then register two more: current tail wins.
	require.NoError(t, ServerShared.UpdateManualOrder(ctx, []uint64{1, 9, 7, 2}))
	second := add("second-new")
	third := add("third-new")
	want := []uint64{1, 9, 7, 2, second.ID, third.ID}
	check := func() {
		var actual []uint64
		for _, s := range ServerShared.GetSortedList() {
			actual = append(actual, s.ID)
		}
		require.Equal(t, want, actual)
	}
	check()
	ServerShared = NewServerClass()
	check() // persisted order survives a restart
	var logs []model.ServerOperationLog
	require.NoError(t, DB.Where("action = ?", "order").Find(&logs).Error)
	require.NotEmpty(t, logs)
	for _, entry := range logs {
		require.Equal(t, "display_index", entry.Changes[0].Field)
	}
	var creates int64
	require.NoError(t, DB.Model(&model.ServerOperationLog{}).Where("action = ?", "create").Count(&creates).Error)
	require.EqualValues(t, 3, creates)
}
func TestNewServerAppendsAfterNegativeLegacyTail(t *testing.T) {
	setupPermanentDeleteTest(t)
	require.NoError(t, DB.Create(&model.Server{Common: model.Common{ID: 30, UserID: 1}, UUID: "tail", DisplayIndex: -100}).Error)
	s, err := CreateServerWithLowestAvailableID(1, "new-negative", "new")
	require.NoError(t, err)
	require.Equal(t, -101, s.DisplayIndex)
}
