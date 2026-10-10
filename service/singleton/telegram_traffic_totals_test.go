package singleton

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
)

func TestTelegramTrafficSeparatesLifetimeAndAllPageDailyTotals(t *testing.T) {
	telegramSetup(t)
	now := trafficTime("2026-10-10T20:00:00+08:00")
	rows := make([]telegramServerRow, 0, 16)
	for i := 0; i < 16; i++ {
		uuid := fmt.Sprintf("total-%d", i)
		rows = append(rows, telegramServerRow{ID: uint64(i + 1), UUID: uuid, Name: uuid, TotalIn: 1 << 40, TotalOut: 2 << 40, HasCounters: true})
		require.NoError(t, DB.Create(&model.PlanTrafficDay{UUID: uuid, Day: "2026-10-10", In: 100, Out: 200}).Error)
		require.NoError(t, DB.Create(&model.PlanTrafficCheckpoint{UUID: uuid, At: now.UnixMilli(), CoveredFrom: now.Add(-24 * time.Hour).UnixMilli()}).Error)
	}
	sum, err := telegramTrafficQuery(context.Background(), rows, now, now)
	require.NoError(t, err)
	require.Equal(t, float64(1600), sum.In)
	require.Equal(t, float64(3200), sum.Out)
	require.Equal(t, float64(16*(1<<40)), sum.TotalIn)
	require.Equal(t, float64(32*(1<<40)), sum.TotalOut)
	for page := 0; page < 2; page++ {
		view, err := telegramTrafficView(context.Background(), rows, "traffic", page, now)
		require.NoError(t, err)
		require.Contains(t, view.Text, "今日总用量（00:00 至当前）")
		require.Contains(t, view.Text, "双向合计：4.69 KiB")
		require.Contains(t, view.Text, "累计合计：48.00 TiB")
	}
}

func TestTelegramTrafficUnreliableNeverDisplayedAsUsage(t *testing.T) {
	_, now := telegramTrafficFixture(t)
	require.NoError(t, DB.Model(&model.PlanTrafficDay{}).Where("uuid = ? AND day = ?", "own-uuid", "2026-10-11").Updates(map[string]any{"unreliable": true, "in": 1 << 40, "out": 2 << 40}).Error)
	rows, err := telegramServerRows(10, now)
	require.NoError(t, err)
	sum, err := telegramTrafficQuery(context.Background(), rows, now, now)
	require.NoError(t, err)
	require.Zero(t, sum.In+sum.Out)
	require.Equal(t, 1, sum.Unavailable)
	require.Equal(t, 1, sum.Partial)
	view, err := telegramTrafficView(context.Background(), rows, "traffic", 0, now)
	require.NoError(t, err)
	require.Contains(t, view.Text, "暂无可核实用量")
	require.NotContains(t, view.Text, "3.00 TiB")
	require.NotContains(t, telegramDailyText(sum), "合计 0 B")
	require.Contains(t, telegramDailyText(sum), "暂无可核实记录")
}

func TestTelegramTrafficCumulativeUsesAuthorizedRuntime(t *testing.T) {
	telegramSetup(t)
	now := time.Now()
	ServerShared.InsertForTest(&model.Server{Common: model.Common{ID: 11, UserID: 10}, Name: "own", UUID: "own", LastActive: now, State: &model.HostState{NetInTransfer: 1000, NetOutTransfer: 2000}})
	ServerShared.InsertForTest(&model.Server{Common: model.Common{ID: 12, UserID: 999}, Name: "secret", UUID: "secret", LastActive: now, State: &model.HostState{NetInTransfer: 1 << 40, NetOutTransfer: 2 << 40}})
	rows, err := telegramServerRows(10, now)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.True(t, rows[0].HasCounters)
	require.EqualValues(t, 1000, rows[0].TotalIn)
	require.EqualValues(t, 2000, rows[0].TotalOut)
	require.False(t, strings.Contains(telegramTrafficHeader(telegramTrafficSummary{Rows: []telegramTrafficRow{{}}, Day: "2026-10-09"}, "📊 每日流量用量"), "今日总用量"))
}
