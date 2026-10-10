package singleton

import (
	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func TestPlanTrafficDelayedUptimeNeverAddsLifetimeAgain(t *testing.T) {
	for _, tc := range []struct {
		name    string
		elapsed int
		uptime  uint64
	}{
		{"cached", 30, 1000}, {"slow-sample", 60, 1005}, {"small-backward", 10, 999}, {"reconnect", 3600, 1020},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := trafficFixture(t)
			at := trafficTime("2026-10-10T12:00:00+08:00")
			require.NoError(t, PersistPlanTraffic(s.ID, s.UUID, trafficSample(at, 1<<40, 2<<40, 1000)))
			require.NoError(t, PersistPlanTraffic(s.ID, s.UUID, trafficSample(at.Add(time.Duration(tc.elapsed)*time.Second), (1<<40)+100, (2<<40)+200, tc.uptime)))
			stat, err := QueryPlanTraffic(s, at.Add(time.Hour))
			require.NoError(t, err)
			require.EqualValues(t, 300, stat.Used)
		})
	}
}
func TestPlanTrafficResetIsPerDirection(t *testing.T) {
	s := trafficFixture(t)
	at := trafficTime("2026-10-10T12:00:00+08:00")
	require.NoError(t, PersistPlanTraffic(s.ID, s.UUID, trafficSample(at, 1000, 2000, 100)))
	require.NoError(t, PersistPlanTraffic(s.ID, s.UUID, trafficSample(at.Add(10*time.Second), 20, 2100, 5)))
	stat, err := QueryPlanTraffic(s, at.Add(time.Hour))
	require.NoError(t, err)
	require.EqualValues(t, 120, stat.Used)
	require.True(t, stat.Estimated)
}
func TestPlanTrafficExcludesUnrecoverableDays(t *testing.T) {
	s := trafficFixture(t)
	at := trafficTime("2026-10-10T12:00:00+08:00")
	require.NoError(t, PersistPlanTraffic(s.ID, s.UUID, trafficSample(at, 1000, 2000, 100)))
	require.NoError(t, DB.Create(&model.PlanTrafficDay{UUID: s.UUID, Day: "2026-10-09", In: 1 << 40, Out: 1 << 40, Unreliable: true}).Error)
	require.NoError(t, DB.Create(&model.PlanTrafficDay{UUID: s.UUID, Day: "2026-10-10", In: 100, Out: 200, Partial: true, Estimated: true}).Error)
	stat, err := QueryPlanTraffic(s, at)
	require.NoError(t, err)
	require.EqualValues(t, 300, stat.Used)
	require.True(t, stat.Partial)
	require.True(t, stat.Estimated)
}
