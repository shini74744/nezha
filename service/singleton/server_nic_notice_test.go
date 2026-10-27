package singleton

import (
	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"strings"
	"testing"
)

func TestNICNoticeOnceReadSurvivesRepeatedReportsAndRestart(t *testing.T) {
	setupPermanentDeleteTest(t)
	require.NoError(t, DB.AutoMigrate(&model.ServerNICNotice{}))
	require.NoError(t, PersistNICSelectionNotice("machine-a", "event-a"))
	var row model.ServerNICNotice
	require.NoError(t, DB.First(&row, "uuid = ?", "machine-a").Error)
	require.True(t, row.Unread)
	read, err := AcknowledgeNICSelectionNotice("machine-a", "event-a")
	require.NoError(t, err)
	require.True(t, read)
	for i := 0; i < 5; i++ {
		require.NoError(t, PersistNICSelectionNotice("machine-a", "event-a"))
	}
	ForgetNICSelectionNotice("machine-a")
	require.NoError(t, PersistNICSelectionNotice("machine-a", "event-a"))
	require.NoError(t, DB.First(&row, "uuid = ?", "machine-a").Error)
	require.False(t, row.Unread)
	require.NoError(t, PersistNICSelectionNotice("machine-a", "event-b"))
	read, err = AcknowledgeNICSelectionNotice("machine-a", "event-a")
	require.NoError(t, err)
	require.False(t, read)
	require.NoError(t, DB.First(&row, "uuid = ?", "machine-a").Error)
	require.True(t, row.Unread)
	require.Equal(t, "event-b", row.EventID)
	var count int64
	require.NoError(t, DB.Model(&model.ServerNICNotice{}).Count(&count).Error)
	require.EqualValues(t, 1, count)
}
func TestNICNoticeFailedWriteRetriesAndDoesNotCrossMachines(t *testing.T) {
	setupPermanentDeleteTest(t)
	require.Error(t, PersistNICSelectionNotice("machine-a", "event-a"))
	require.NoError(t, DB.AutoMigrate(&model.ServerNICNotice{}))
	require.NoError(t, PersistNICSelectionNotice("machine-a", "event-a"))
	require.NoError(t, PersistNICSelectionNotice("machine-b", "event-a"))
	read, err := AcknowledgeNICSelectionNotice("machine-b", "wrong")
	require.NoError(t, err)
	require.False(t, read)
	require.Error(t, PersistNICSelectionNotice("machine-a", strings.Repeat("x", 65)))
	require.NoError(t, PersistNICSelectionNotice("machine-a", ""))
	read, err = AcknowledgeNICSelectionNotice("machine-a", "event-a")
	require.NoError(t, err)
	require.True(t, read)
	var row model.ServerNICNotice
	require.NoError(t, DB.First(&row, "uuid = ?", "machine-b").Error)
	require.True(t, row.Unread)
}
