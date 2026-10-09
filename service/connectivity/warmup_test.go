package connectivity

import (
	"context"
	"encoding/json"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestWarmupTimingsNeverBecomeSamplesOrPersistedAverage(t *testing.T) {
	m := NewManager()
	selected := Targets()[:1]
	delays := []float64{900, 700, 10, 20, 30}
	var calls atomic.Int32
	persisted := make(chan Snapshot, 1)
	m.SetCompletionHandler(func(_ string, s Snapshot) { persisted <- s })
	_, err := m.Start("warm", func(context.Context, Target) Sample {
		n := int(calls.Add(1)) - 1
		if n >= len(delays) {
			t.Error("unexpected probe")
			return Sample{Status: "error"}
		}
		v := delays[n]
		return Sample{Status: "ok", DelayMS: &v}
	}, selected)
	require.NoError(t, err)
	var saved Snapshot
	select {
	case saved = <-persisted:
	case <-time.After(time.Second):
		t.Fatal("timeout")
	}
	require.EqualValues(t, 5, calls.Load())
	require.Equal(t, 3, saved.Rounds)
	require.Len(t, saved.Results[0].Samples, 3)
	require.Equal(t, 20.0, *saved.Results[0].DelayMS)
	for i, s := range saved.Results[0].Samples {
		require.Equal(t, delays[i+2], *s.DelayMS)
	}
	require.Equal(t, "ok", saved.Results[0].Status)
}
func TestWarmupFailureIsNotAReportedFailureWhenMeasuredRequestsSucceed(t *testing.T) {
	m := NewManager()
	var calls atomic.Int32
	_, err := m.Start("warm-fail", func(context.Context, Target) Sample {
		if calls.Add(1) <= WarmupRounds {
			return Sample{Status: "timeout"}
		}
		v := 8.0
		return Sample{Status: "ok", DelayMS: &v}
	}, Targets()[:1])
	require.NoError(t, err)
	require.Eventually(t, func() bool { return m.Get("warm-fail", Targets()[:1]).State == "complete" }, time.Second, time.Millisecond)
	s := m.Get("warm-fail", Targets()[:1])
	require.Equal(t, "ok", s.Results[0].Status)
	require.Len(t, s.Results[0].Samples, 3)
	require.Equal(t, 8.0, *s.Results[0].DelayMS)
}
func TestLegacyResourceUpgradePreservesCustomizations(t *testing.T) {
	items := DefaultCatalog()
	for i := range items {
		if old, ok := legacyEndpoints[items[i].ID]; ok {
			items[i].URL = old
		}
		items[i].Name = "Custom " + items[i].ID
		items[i].Enabled = i%2 == 0
	}
	items[0].URL = "https://custom.example.org/health?token=private"
	raw, err := json.Marshal(items)
	require.NoError(t, err)
	result, err := ParseCatalog(string(raw))
	require.NoError(t, err)
	require.Len(t, result, len(items))
	for i, item := range result {
		require.Equal(t, items[i].ID, item.ID)
		require.Equal(t, items[i].Name, item.Name)
		require.Equal(t, items[i].Enabled, item.Enabled)
		require.Equal(t, items[i].Icon, item.Icon)
		if i == 0 {
			require.Equal(t, items[i].URL, item.URL)
		} else {
			target, _ := FindTarget(item.ID)
			require.Equal(t, target.URL, item.URL)
		}
	}
	// No in-memory mutation of the source or serialization of private paths into public results.
	require.Contains(t, string(raw), "token=private")
	public, _ := json.Marshal(empty(3, EnabledTargets(result)))
	require.NotContains(t, string(public), "token=private")
}
