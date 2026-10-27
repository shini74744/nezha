package singleton

import (
	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func TestNICSelectionPreservesQuotaWithoutInventingUsage(t *testing.T) {
	for _, tc := range []struct {
		name          string
		before, after uint64
	}{
		{"remove", 600 << 30, 100 << 30}, {"add", 100 << 30, 600 << 30}, {"off_on", 0, 100 << 30}, {"all_off", 600 << 30, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := trafficFixture(t)
			at := trafficTime("2026-09-20T10:00:00+08:00")
			report := func(sec int, in uint64, epoch string) {
				sample := trafficSample(at.Add(time.Duration(sec)*time.Second), in, 0, 1000+uint64(sec))
				sample.State.NetworkCounterEpoch = epoch
				require.NoError(t, PersistPlanTraffic(s.ID, s.UUID, sample))
			}
			report(0, tc.before, "old")
			report(1, tc.before+80, "old")
			report(2, tc.after, "new")
			stat, err := QueryPlanTraffic(s, at.Add(2*time.Second))
			require.NoError(t, err)
			require.EqualValues(t, 80, stat.Used)
			require.True(t, stat.Partial)
			require.True(t, stat.Estimated)
			report(3, tc.after+123, "new")
			stat, err = QueryPlanTraffic(s, at.Add(3*time.Second))
			require.NoError(t, err)
			require.EqualValues(t, 203, stat.Used)
			var checkpoint model.PlanTrafficCheckpoint
			require.NoError(t, DB.First(&checkpoint, "uuid = ?", s.UUID).Error)
			require.Equal(t, "new", checkpoint.NetworkCounterEpoch)
			// Stale or duplicate reports must not move the persistent baseline backwards.
			report(2, 1<<40, "old")
			report(4, tc.after+124, "new")
			stat, err = QueryPlanTraffic(s, at.Add(4*time.Second))
			require.NoError(t, err)
			require.EqualValues(t, 204, stat.Used)
		})
	}
}
func TestNICCounterEpochUpgradeDowngradeAndAgentRestart(t *testing.T) {
	s := trafficFixture(t)
	at := trafficTime("2026-09-20T10:00:00+08:00")
	for i, x := range []struct {
		in    uint64
		epoch string
	}{
		{100, ""}, {120, ""}, {1 << 30, "process-a"}, {1<<30 + 5, "process-a"},
		{1 << 40, "process-b"}, {1<<40 + 7, "process-b"}, {300, ""}, {309, ""},
	} {
		sample := trafficSample(at.Add(time.Duration(i)*time.Second), x.in, 0, 1000+uint64(i))
		sample.State.NetworkCounterEpoch = x.epoch
		require.NoError(t, PersistPlanTraffic(s.ID, s.UUID, sample))
	}
	stat, err := QueryPlanTraffic(s, at.Add(10*time.Second))
	require.NoError(t, err)
	require.EqualValues(t, 41, stat.Used) // 20 legacy + 5 + 7 + 9; no lifetime totals.
}

func TestNICCounterEpochMigrationPreservesLegacyCheckpoint(t *testing.T) {
	setupCleanMonitorHistoryTestDB(t)
	require.NoError(t, DB.Exec("CREATE TABLE plan_traffic_checkpoints (uuid TEXT PRIMARY KEY, at INTEGER, `in` INTEGER, `out` INTEGER, uptime INTEGER, covered_from INTEGER)").Error)
	at := trafficTime("2026-09-20T10:00:00+08:00")
	uuid := "clean-monitor-history-test"
	require.NoError(t, DB.Exec("INSERT INTO plan_traffic_checkpoints (uuid, at, `in`, `out`, uptime, covered_from) VALUES (?, ?, ?, ?, ?, ?)", uuid, at.UnixMilli(), 1000, 2000, 100, at.UnixMilli()).Error)
	require.NoError(t, DB.AutoMigrate(&model.PlanTrafficCheckpoint{}, &model.PlanTrafficDay{}))
	var checkpoint model.PlanTrafficCheckpoint
	require.NoError(t, DB.First(&checkpoint, "uuid = ?", uuid).Error)
	require.Empty(t, checkpoint.NetworkCounterEpoch)
	require.EqualValues(t, 1000, checkpoint.In)
	require.EqualValues(t, 2000, checkpoint.Out)
	require.Equal(t, at.UnixMilli(), checkpoint.CoveredFrom)
	require.NoError(t, DB.Create(&model.PlanTrafficDay{UUID: uuid, Day: "2026-09-20", In: 77}).Error)
	var server model.Server
	require.NoError(t, DB.First(&server, 1).Error)
	sample := trafficSample(at.Add(time.Second), 600<<30, 300<<30, 101)
	sample.State.NetworkCounterEpoch = "new-agent"
	require.NoError(t, PersistPlanTraffic(server.ID, server.UUID, sample))
	stat, err := QueryPlanTraffic(&server, at.Add(time.Second))
	require.NoError(t, err)
	require.EqualValues(t, 77, stat.Used)
}
