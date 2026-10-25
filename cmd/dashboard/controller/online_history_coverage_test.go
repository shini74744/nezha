package controller

import (
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func TestOnlineHistoryExcludesUnobservedTime(t *testing.T) {
	setupOnlineHistoryControllerTest(t)
	require.NoError(t, singleton.DB.AutoMigrate(&model.OnlineHistoryCoverage{}))
	start := time.Now().UTC().Add(-10 * time.Minute).Truncate(time.Second)
	require.NoError(t, singleton.DB.Create(&model.OnlineHistoryCoverage{ServerID: 1, StartedAt: start}).Error)
	require.NoError(t, singleton.DB.Create(&model.OnlineSession{ServerID: 1, StartedAt: start, LastActiveAt: time.Now(), Ongoing: true}).Error)
	response, err := getServerOnlineHistory(onlineHistoryCtxAsMember(t, "1", "days=30"))
	require.NoError(t, err)
	require.True(t, response.WindowStart.Equal(start))
	require.InDelta(t, 100, response.OnlineRate, 0.01)
	require.LessOrEqual(t, response.TotalOnlineSeconds, uint64(601))
	require.GreaterOrEqual(t, response.TotalOnlineSeconds, uint64(600))
}
func TestOnlineHistoryNeverReportedHasNoInventedOutage(t *testing.T) {
	setupOnlineHistoryControllerTest(t)
	require.NoError(t, singleton.DB.AutoMigrate(&model.OnlineHistoryCoverage{}))
	response, err := getServerOnlineHistory(onlineHistoryCtx(t, "1", "days=1"))
	require.NoError(t, err)
	require.True(t, response.WindowStart.Equal(response.WindowEnd))
	require.Zero(t, response.TotalOnlineSeconds)
	require.Empty(t, response.Periods)
}
