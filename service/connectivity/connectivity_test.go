package connectivity

import (
	"context"
	"encoding/json"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func waitComplete(t *testing.T, m *Manager, key string) Snapshot {
	t.Helper()
	require.Eventually(t, func() bool { return m.Get(key).State == "complete" }, time.Second, time.Millisecond)
	return m.Get(key)
}
func TestFixedTargets(t *testing.T) {
	got := Targets()
	require.Len(t, got, 12)
	seen := map[string]bool{}
	for _, target := range got {
		u, err := url.Parse(target.URL)
		require.NoError(t, err)
		require.Equal(t, "https", u.Scheme)
		require.Equal(t, target.Host, u.Hostname())
		require.Empty(t, u.Port())
		require.False(t, seen[target.ID])
		seen[target.ID] = true
	}
	got[0].URL = "http://127.0.0.1/"
	original, _ := FindTarget(got[0].ID)
	require.NotEqual(t, got[0].URL, original.URL)
	_, ok := FindTarget("https://169.254.169.254/")
	require.False(t, ok)
	raw, _ := json.Marshal(empty(3))
	require.False(t, strings.Contains(string(raw), "https://"))
}
func TestManagerDeduplicatesCooldownAndMedian(t *testing.T) {
	m := NewManager()
	now := time.Now()
	m.now = func() time.Time { return now }
	release := make(chan struct{})
	var calls atomic.Int32
	probe := func(ctx context.Context, _ Target) Sample {
		select {
		case <-release:
		case <-ctx.Done():
		}
		calls.Add(1)
		v := 21.5
		return Sample{Status: "ok", DelayMS: &v}
	}
	first, err := m.Start("node-a", probe)
	require.NoError(t, err)
	require.Equal(t, "running", first.State)
	var wg sync.WaitGroup
	for i := 0; i < 30; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, e := m.Start("node-a", probe); require.NoError(t, e) }()
	}
	wg.Wait()
	close(release)
	result := waitComplete(t, m, "node-a")
	require.EqualValues(t, 36, calls.Load())
	for _, r := range result.Results {
		require.Equal(t, "ok", r.Status)
		require.Len(t, r.Samples, 3)
		require.Equal(t, 21.5, *r.DelayMS)
	}
	cached, err := m.Start("node-a", probe)
	require.NoError(t, err)
	require.Equal(t, result.StartedAt, cached.StartedAt)
	require.EqualValues(t, 36, calls.Load())
	// Snapshot copies must not expose the mutable running collection.
	cached.Results[0].Status = "modified"
	cached.Results[0].Samples[0].Status = "modified"
	require.Equal(t, "ok", m.Get("node-a").Results[0].Status)
	require.Equal(t, "ok", m.Get("node-a").Results[0].Samples[0].Status)
	now = now.Add(61 * time.Second)
	_, err = m.Start("node-a", probe)
	require.NoError(t, err)
	waitComplete(t, m, "node-a")
	require.EqualValues(t, 72, calls.Load())
	now = now.Add(25 * time.Hour)
	require.Equal(t, "idle", m.Get("node-a").State)
}
func TestManagerGlobalBoundAndIdentityIsolation(t *testing.T) {
	m := NewManager()
	m.maxActive = 1
	release := make(chan struct{})
	_, err := m.Start("1:uuid:owner", func(context.Context, Target) Sample { <-release; return Sample{Status: "offline"} })
	require.NoError(t, err)
	_, err = m.Start("2:uuid2:owner", func(context.Context, Target) Sample { t.Fatal("must not run"); return Sample{} })
	require.ErrorIs(t, err, ErrBusy)
	require.Equal(t, "idle", m.Get("1:uuid:other-owner").State)
	close(release)
	waitComplete(t, m, "1:uuid:owner")
}
func TestManagerCapacityDoesNotEvictCooldown(t *testing.T) {
	m := NewManager()
	m.maxEntries = 1
	probe := func(context.Context, Target) Sample { return Sample{Status: "ok"} }
	_, err := m.Start("a", probe)
	require.NoError(t, err)
	waitComplete(t, m, "a")
	_, err = m.Start("b", probe)
	require.ErrorIs(t, err, ErrBusy)
	m.mu.Lock()
	m.entries["a"].snapshot.RetryAt = 0
	m.mu.Unlock()
	_, err = m.Start("b", probe)
	require.NoError(t, err)
	waitComplete(t, m, "b")
	require.Equal(t, "idle", m.Get("a").State)
}
func TestManagerDeadlineCompletesAndReleasesSlot(t *testing.T) {
	m := NewManager()
	m.timeout = 5 * time.Millisecond
	_, err := m.Start("a", func(ctx context.Context, _ Target) Sample { <-ctx.Done(); return Sample{Status: "agent_timeout"} })
	require.NoError(t, err)
	result := waitComplete(t, m, "a")
	for _, r := range result.Results {
		require.Equal(t, "agent_timeout", r.Status)
		require.Len(t, r.Samples, 3)
	}
	m.mu.Lock()
	require.Zero(t, m.active)
	m.mu.Unlock()
}
func TestMixedOutcomesAndMedian(t *testing.T) {
	a, b := float64(10), float64(100)
	r := Result{Samples: []Sample{{Status: "ok", DelayMS: &a}, {Status: "http_error", HTTPStatus: 403, DelayMS: &b}, {Status: "timeout"}}}
	summarize(&r)
	require.Equal(t, "unstable", r.Status)
	require.Equal(t, 55.0, *r.DelayMS)
	r = Result{Samples: []Sample{{Status: "timeout"}, {Status: "timeout"}, {Status: "timeout"}}}
	summarize(&r)
	require.Nil(t, r.DelayMS)
}
