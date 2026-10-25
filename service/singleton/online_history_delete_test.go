package singleton

import (
	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func TestPermanentDeleteClearsOnlyTargetOnlineHistory(t *testing.T) {
	setupPermanentDeleteTest(t)
	require.NoError(t, DB.AutoMigrate(&model.OnlineSession{}, &model.OnlineHistoryCoverage{}))
	previous := OnlineHistoryShared
	t.Cleanup(func() { OnlineHistoryShared = previous })
	OnlineHistoryShared = NewOnlineHistoryRecorder()
	now := time.Now().UTC()
	for _, id := range []uint64{11, 12} {
		server := model.Server{Common: model.Common{ID: id, UserID: 1}, UUID: "online-delete-" + fmtID(id), Name: "online"}
		require.NoError(t, DB.Create(&server).Error)
		model.InitServer(&server)
		ServerShared.Update(&server, server.UUID)
		OnlineHistoryShared.RecordOnline(id, now)
	}
	require.NoError(t, PermanentlyDeleteServers([]uint64{11}))
	require.Equal(t, int64(0), countOnlineSessions(t, "server_id = ?", 11))
	require.Equal(t, int64(1), countOnlineSessions(t, "server_id = ?", 12))
	_, exists := OnlineHistoryShared.open[11]
	require.False(t, exists)
	var count int64
	require.NoError(t, DB.Model(&model.OnlineHistoryCoverage{}).Where("server_id = ?", 11).Count(&count).Error)
	require.Zero(t, count)
	require.NoError(t, DB.Model(&model.OnlineHistoryCoverage{}).Where("server_id = ?", 12).Count(&count).Error)
	require.Equal(t, int64(1), count)
}
