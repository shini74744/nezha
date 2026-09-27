package singleton

import (
	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func trafficTime(v string) time.Time { t, _ := time.Parse(time.RFC3339, v); return t }
func trafficSample(at time.Time, in, out, uptime uint64) model.RecordedServerState {
	return model.RecordedServerState{At: at.UnixMilli(), State: &model.HostState{NetInTransfer: in, NetOutTransfer: out, Uptime: uptime}}
}
func trafficFixture(t *testing.T) *model.Server {
	setupCleanMonitorHistoryTestDB(t)
	require.NoError(t, DB.AutoMigrate(&model.PlanTrafficCheckpoint{}, &model.PlanTrafficDay{}))
	var s model.Server
	require.NoError(t, DB.First(&s, 1).Error)
	s.PublicNote = `{"planDataMod":{"trafficVol":"5TB/月","resetDay":"15","trafficType":"0"}}`
	return &s
}
func TestPlanTrafficBothDirectionsResetAndRemap(t *testing.T) {
	s := trafficFixture(t)
	at := trafficTime("2026-09-14T23:59:50+08:00")
	require.NoError(t, PersistPlanTraffic(s.ID, s.UUID, trafficSample(at, 10000, 20000, 1000)))
	require.NoError(t, PersistPlanTraffic(s.ID, s.UUID, trafficSample(at.Add(10*time.Second), 10100, 20200, 1010)))
	old, err := QueryPlanTraffic(s, at)
	require.NoError(t, err)
	require.EqualValues(t, 300, old.Used)
	next, err := QueryPlanTraffic(s, at.Add(10*time.Second))
	require.NoError(t, err)
	require.Zero(t, next.Used)
	require.NoError(t, PersistPlanTraffic(s.ID, s.UUID, trafficSample(at.Add(20*time.Second), 10170, 20230, 1020)))
	stat, err := QueryPlanTraffic(s, at.Add(20*time.Second))
	require.NoError(t, err)
	require.EqualValues(t, 100, stat.Used)
	for _, tc := range []struct {
		dir  string
		want uint64
	}{{"1", 70}, {"3", 30}, {"2", 100}, {"0", 100}} {
		s.PublicNote = `{"planDataMod":{"trafficVol":"5TB/月","resetDay":"15","trafficType":"` + tc.dir + `"}}`
		stat, err = QueryPlanTraffic(s, at.Add(20*time.Second))
		require.NoError(t, err)
		require.Equal(t, tc.want, stat.Used)
	}
	// Changed display IDs retain UUID-owned history; a different UUID at the old ID cannot claim it.
	require.NoError(t, DB.Model(&model.Server{}).Where("id = ?", s.ID).Update("id", 99).Error)
	s.ID = 99
	stat, err = QueryPlanTraffic(s, at.Add(20*time.Second))
	require.NoError(t, err)
	require.EqualValues(t, 100, stat.Used)
	require.NoError(t, PersistPlanTraffic(1, s.UUID, trafficSample(at.Add(30*time.Second), 99999, 99999, 1030)))
	stat, err = QueryPlanTraffic(s, at.Add(30*time.Second))
	require.NoError(t, err)
	require.EqualValues(t, 100, stat.Used)
	var rows int64
	require.NoError(t, DB.Model(&model.PlanTrafficDay{}).Count(&rows).Error)
	require.EqualValues(t, 2, rows)
	CleanMonitorHistory() // Legacy rule cleanup must never delete the independent ledger.
	stat, err = QueryPlanTraffic(s, at.Add(30*time.Second))
	require.NoError(t, err)
	require.EqualValues(t, 100, stat.Used)
	future, err := QueryPlanTraffic(s, trafficTime("2026-10-15T00:00:00+08:00"))
	require.NoError(t, err)
	require.Zero(t, future.Used)
}
func TestPlanTrafficRestartRebootStaleAndTransaction(t *testing.T) {
	s := trafficFixture(t)
	at := trafficTime("2026-09-20T10:00:00+08:00")
	report := func(sec int, in, out, uptime uint64) {
		require.NoError(t, PersistPlanTraffic(s.ID, s.UUID, trafficSample(at.Add(time.Duration(sec)*time.Second), in, out, uptime)))
	}
	report(0, 1000, 2000, 100)
	report(10, 1100, 2200, 110)
	report(10, 1100, 2200, 110)
	report(5, 999999, 999999, 105)
	stat, err := QueryPlanTraffic(s, at.Add(time.Minute))
	require.NoError(t, err)
	require.EqualValues(t, 300, stat.Used)
	// Persisted checkpoints, no volatile process baseline: reconnect never adds lifetime totals.
	report(20, 1200, 2300, 120)
	report(30, 20, 30, 5) // Host reboot / counter reset.
	stat, err = QueryPlanTraffic(s, at.Add(time.Minute))
	require.NoError(t, err)
	require.EqualValues(t, 550, stat.Used)
	require.True(t, stat.Estimated)
	require.NoError(t, DB.Exec("CREATE TRIGGER fail_traffic BEFORE UPDATE ON plan_traffic_checkpoints BEGIN SELECT RAISE(ABORT,'fixture failure'); END").Error)
	require.Error(t, PersistPlanTraffic(s.ID, s.UUID, trafficSample(at.Add(40*time.Second), 30, 40, 15)))
	require.NoError(t, DB.Exec("DROP TRIGGER fail_traffic").Error)
	report(40, 30, 40, 15)
	stat, err = QueryPlanTraffic(s, at.Add(time.Minute))
	require.NoError(t, err)
	require.EqualValues(t, 570, stat.Used)
}
func TestPlanTrafficLegacySeedExactlyOnce(t *testing.T) {
	s := trafficFixture(t)
	now := trafficTime("2026-09-20T10:00:00+08:00")
	require.NoError(t, DB.Create(&model.Transfer{Common: model.Common{CreatedAt: trafficTime("2026-09-15T00:00:00+08:00")}, ServerID: s.ID, In: 100, Out: 200}).Error)
	require.NoError(t, DB.Create(&model.Transfer{Common: model.Common{CreatedAt: trafficTime("2026-09-16T01:00:00+08:00")}, ServerID: s.ID, In: 40, Out: 60}).Error)
	require.NoError(t, initPlanTraffic(DB, now))
	require.NoError(t, initPlanTraffic(DB, now))
	stat, err := QueryPlanTraffic(s, now)
	require.NoError(t, err)
	require.EqualValues(t, 100, stat.Used)
	require.True(t, stat.Partial)
	require.True(t, stat.Estimated)
	require.NoError(t, PersistPlanTraffic(s.ID, s.UUID, trafficSample(now, 100000, 200000, 500)))
	require.NoError(t, PersistPlanTraffic(s.ID, s.UUID, trafficSample(now.Add(time.Second), 100001, 200002, 501)))
	stat, err = QueryPlanTraffic(s, now)
	require.NoError(t, err)
	require.EqualValues(t, 103, stat.Used)
	require.NoError(t, initPlanTraffic(DB, now.Add(time.Minute)))
	stat, err = QueryPlanTraffic(s, now)
	require.NoError(t, err)
	require.EqualValues(t, 103, stat.Used)
}
func TestPlanTrafficSplitConservesBytes(t *testing.T) {
	from := trafficTime("2026-09-14T23:59:59+08:00").UnixMilli()
	rows := splitTrafficDays("x", from, from+2000, 5, 7, true)
	require.Len(t, rows, 2)
	require.EqualValues(t, 2, rows[0].In)
	require.EqualValues(t, 3, rows[1].In)
	require.EqualValues(t, 7, rows[0].Out+rows[1].Out)
	require.Equal(t, "2026-09-15", rows[1].Day)
}
