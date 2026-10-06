package connectivity

import (
	"context"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func TestLatestCompletedSurvivesBackgroundRun(t *testing.T) {
	m := NewManager()
	m.cooldown = 0
	targets := Targets()[:1]
	finished := make(chan Snapshot, 2)
	m.SetCompletionHandler(func(_ string, s Snapshot) { finished <- s })
	_, err := m.Start("node", func(context.Context, Target) Sample { return Sample{Status: "ok"} }, targets)
	require.NoError(t, err)
	before := <-finished
	gate := make(chan struct{})
	released := false
	defer func() {
		if !released {
			close(gate)
			<-finished
		}
	}()
	slot := ClockSlot(time.Now(), 2).UnixMilli()
	_, err = m.StartScheduled("node", func(context.Context, Target) Sample { <-gate; return Sample{Status: "timeout"} }, targets, slot)
	require.NoError(t, err)
	require.Equal(t, "running", m.Get("node", targets).State)
	latest, ok := m.LatestCompleted("node", targets)
	require.True(t, ok)
	require.Equal(t, before, latest)
	latest.Results[0].Samples[0].Status = "changed"
	latest, _ = m.LatestCompleted("node", targets)
	require.Equal(t, "ok", latest.Results[0].Samples[0].Status)
	changed := append([]Target(nil), targets...)
	changed[0].URL = "https://changed.example/"
	_, ok = m.LatestCompleted("node", changed)
	require.False(t, ok)
	_, ok = m.LatestCompleted("other-owner", targets)
	require.False(t, ok)
	m.SetRetention(time.Nanosecond)
	require.Eventually(t, func() bool { _, ok := m.LatestCompleted("node", targets); return !ok }, time.Second, time.Millisecond)
	m.SetRetention(24 * time.Hour)
	close(gate)
	released = true
	after := <-finished
	require.Equal(t, slot, after.ScheduledAt)
	latest, ok = m.LatestCompleted("node", targets)
	require.True(t, ok)
	require.Equal(t, after, latest)
	require.Equal(t, "timeout", latest.Results[0].Status)
}

func TestClockSlotsUTC8IndependentOfHostAndNoDrift(t *testing.T) {
	cst := time.FixedZone("CST", 8*3600)
	midnight := time.Date(2026, 10, 7, 0, 0, 0, 0, cst)
	for _, hours := range []int{1, 2, 3, 4, 6, 8, 12, 24} {
		for h := 0; h < 24; h++ {
			now := midnight.Add(time.Duration(h)*time.Hour + 47*time.Minute + 42*time.Second)
			slot := ClockSlot(now, hours)
			require.Equal(t, midnight.Add(time.Duration(h/hours*hours)*time.Hour).UnixMilli(), slot.UnixMilli())
			require.Equal(t, slot, ClockSlot(now.UTC(), hours))
			require.Equal(t, 0, slot.Second())
			require.Equal(t, 0, slot.Minute())
			require.True(t, NextClockSlot(now, hours).After(now))
		}
	}
	require.Equal(t, midnight.UnixMilli(), NextClockSlot(midnight.Add(-time.Second), 6).UnixMilli())
}

func TestSchedulerRestartAndDelayedFinishUseScheduledSlot(t *testing.T) {
	p := DefaultPolicy()
	now := time.Date(2026, 10, 7, 0, 2, 0, 0, time.FixedZone("CST", 8*3600))
	nodes := []Candidate{{Key: "node", ID: 8}}
	var history int64
	calls := 0
	last := func(string) (int64, error) { return history, nil }
	start := func(Candidate) error { calls++; history = ClockSlot(now, p.IntervalHours).UnixMilli(); return nil }
	s := Scheduler{}
	require.NoError(t, s.Tick(now, p, nodes, last, start))
	require.Equal(t, 1, calls)
	s = Scheduler{} // restart within the same slot never duplicates
	now = now.Add(time.Hour)
	require.NoError(t, s.Tick(now, p, nodes, last, start))
	require.Equal(t, 1, calls)
	now = time.Date(2026, 10, 7, 2, 0, 0, 0, now.Location())
	require.NoError(t, s.Tick(now, p, nodes, last, start))
	require.Equal(t, 2, calls)
	require.Equal(t, now.UnixMilli(), history)
}
