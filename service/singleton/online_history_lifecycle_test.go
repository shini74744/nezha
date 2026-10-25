package singleton

import (
	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func TestOnlineCoverageSurvivesRestartAndIDReuse(t *testing.T) {
	setupOnlineHistoryTestDB(t)
	require.NoError(t, DB.AutoMigrate(&model.OnlineHistoryCoverage{}))
	require.NoError(t, InitOnlineHistoryCoverage())
	var first model.OnlineHistoryCoverage
	require.NoError(t, DB.First(&first, "server_id = ?", 1).Error)
	require.NoError(t, InitOnlineHistoryCoverage())
	var next model.OnlineHistoryCoverage
	require.NoError(t, DB.First(&next, "server_id = ?", 1).Error)
	require.True(t, first.StartedAt.Equal(next.StartedAt))
	r := NewOnlineHistoryRecorder()
	now := time.Now().UTC()
	r.RecordOnline(1, now)
	require.Equal(t, int64(1), countOnlineSessions(t, "server_id = ?", 1))
	require.NoError(t, DB.Where("server_id = ?", 1).Delete(&model.OnlineSession{}).Error)
	require.NoError(t, DB.Where("server_id = ?", 1).Delete(&model.OnlineHistoryCoverage{}).Error)
	r.Forget([]uint64{1})
	later := now.Add(time.Minute)
	r.RecordOnline(1, later)
	require.Equal(t, int64(1), countOnlineSessions(t, "server_id = ?", 1))
	require.NoError(t, DB.First(&next, "server_id = ?", 1).Error)
	require.True(t, next.StartedAt.Equal(later))
}
func TestOnlineRecordingStopsDuringIDReassignment(t *testing.T) {
	setupOnlineHistoryTestDB(t)
	r := NewOnlineHistoryRecorder()
	now := time.Now()
	r.RecordOnline(1, now)
	ServerIDReassignmentInProgress.Store(true)
	t.Cleanup(func() { ServerIDReassignmentInProgress.Store(false) })
	r.RecordOnline(2, now)
	r.RecordOffline(1, now.Add(time.Second))
	r.SweepStale(now.Add(time.Hour), func(uint64) (time.Time, bool) { return time.Time{}, false })
	require.Equal(t, int64(1), countOnlineSessions(t, "ongoing = ?", true))
	require.Equal(t, int64(0), countOnlineSessions(t, "server_id = ?", 2))
	ServerIDReassignmentInProgress.Store(false)
	r.RecordOffline(1, now.Add(time.Second))
	require.Equal(t, int64(0), countOnlineSessions(t, "ongoing = ?", true))
}
