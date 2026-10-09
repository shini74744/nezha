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
	require.Len(t, got, 110)
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
	require.EqualValues(t, (MeasuredRounds+WarmupRounds)*len(Targets()), calls.Load())
	for _, r := range result.Results {
		require.Equal(t, "ok", r.Status)
		require.Len(t, r.Samples, MeasuredRounds)
		require.Equal(t, 21.5, *r.DelayMS)
	}
	cached, err := m.Start("node-a", probe)
	require.NoError(t, err)
	require.Equal(t, result.StartedAt, cached.StartedAt)
	require.EqualValues(t, (MeasuredRounds+WarmupRounds)*len(Targets()), calls.Load())
	// Snapshot copies must not expose the mutable running collection.
	cached.Results[0].Status = "modified"
	cached.Results[0].Samples[0].Status = "modified"
	require.Equal(t, "ok", m.Get("node-a").Results[0].Status)
	require.Equal(t, "ok", m.Get("node-a").Results[0].Samples[0].Status)
	now = now.Add(61 * time.Second)
	_, err = m.Start("node-a", probe)
	require.NoError(t, err)
	waitComplete(t, m, "node-a")
	require.EqualValues(t, 2*(MeasuredRounds+WarmupRounds)*len(Targets()), calls.Load())
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
		require.Contains(t, []string{"agent_timeout", "batch_timeout"}, r.Status)
		require.Equal(t, "complete", r.Phase)
		require.LessOrEqual(t, len(r.Samples), 1)
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

func TestExpandedReferenceCatalogAndBudget(t *testing.T) {
	groups := map[string]int{}
	for _, target := range Targets() {
		groups[target.Group]++
	}
	require.Equal(t, map[string]int{"china": 12, "japan": 7, "usa": 36, "global": 11, "korea": 3, "uk": 3, "germany": 3, "france": 3, "canada": 3, "australia": 3, "india": 3, "brazil": 3, "russia": 3, "singapore": 3, "malaysia": 3, "indonesia": 3, "hongkong": 4, "macau": 4}, groups)
	for _, id := range []string{"deepseek", "weixin", "sony", "nintendo", "claude", "chatgpt", "gemini", "steam", "tiktok", "mistral", "mercadolibre"} {
		_, ok := FindTarget(id)
		require.True(t, ok, id)
	}
	m := NewManager()
	require.Equal(t, 12, m.workers)
	// Even if every Agent request reaches the 3s upper bound, all 110 sites
	// must receive their five real attempts before the overall batch deadline.
	batches := (len(Targets()) + m.workers - 1) / m.workers
	require.GreaterOrEqual(t, m.timeout, time.Duration(batches*(m.rounds+WarmupRounds))*ProbeTimeout)
}
func TestExpandedWorkersRemainBounded(t *testing.T) {
	m := NewManager()
	var active, peak, calls atomic.Int32
	probe := func(ctx context.Context, target Target) Sample {
		n := active.Add(1)
		for old := peak.Load(); n > old; old = peak.Load() {
			if peak.CompareAndSwap(old, n) {
				break
			}
		}
		defer active.Add(-1)
		calls.Add(1)
		time.Sleep(time.Millisecond)
		return Sample{Status: "ok"}
	}
	_, err := m.Start("bounded", probe)
	require.NoError(t, err)
	waitComplete(t, m, "bounded")
	require.EqualValues(t, len(Targets())*(MeasuredRounds+WarmupRounds), calls.Load())
	require.LessOrEqual(t, peak.Load(), int32(12))
}
func TestQueueInterleavesRegionsAndRetriesOnlyAfterFirstPass(t *testing.T) {
	m := NewManager()
	m.workers = 1 // Make dispatch order deterministic; production remains bounded at 12.
	var order []string
	_, err := m.Start("fair", func(_ context.Context, target Target) Sample {
		order = append(order, target.ID)
		v := 12.0
		return Sample{Status: "ok", DelayMS: &v}
	})
	require.NoError(t, err)
	result := waitComplete(t, m, "fair")
	require.Len(t, order, len(targets)*(MeasuredRounds+WarmupRounds))
	seen := map[string]bool{}
	for _, id := range order[:len(targets)] {
		require.False(t, seen[id], "a retry jumped ahead of an unstarted target: %s", id)
		seen[id] = true
	}
	groups := map[string]bool{}
	for _, id := range order[:16] {
		target, _ := FindTarget(id)
		groups[target.Group] = true
	}
	require.Len(t, groups, 16)
	for _, r := range result.Results {
		require.Equal(t, "complete", r.Phase)
	}
}
func TestSlowFirstTargetDoesNotHoldLaterTargets(t *testing.T) {
	m := NewManager()
	m.workers = 2
	release := make(chan struct{})
	var once sync.Once
	defer once.Do(func() { close(release) })
	first := targets[0].ID
	var slowCalls atomic.Int32
	_, err := m.Start("slow", func(ctx context.Context, target Target) Sample {
		if target.ID == first {
			slowCalls.Add(1)
			select {
			case <-release:
			case <-ctx.Done():
			}
			return Sample{Status: "timeout"}
		}
		v := 7.0
		return Sample{Status: "ok", DelayMS: &v}
	})
	require.NoError(t, err)
	require.Eventually(t, func() bool {
		s := m.Get("slow")
		return s.Results[0].Phase == "running" && s.Results[len(s.Results)-1].Phase == "complete"
	}, time.Second, time.Millisecond)
	s := m.Get("slow")
	require.Empty(t, s.Results[0].Samples)
	require.Equal(t, "pending", s.Results[0].Status) // phase is authoritative while no response exists.
	for _, r := range s.Results[1:] {
		require.NotEmpty(t, r.Samples)
	}
	require.EqualValues(t, 1, slowCalls.Load())
	once.Do(func() { close(release) })
	waitComplete(t, m, "slow")
}
func TestTimeoutEndsItemWithoutInventedSamplesOrBlockingNextSites(t *testing.T) {
	for _, status := range []string{"offline", "query_disabled"} {
		t.Run(status, func(t *testing.T) {
			m := NewManager()
			m.workers = 1
			var calls atomic.Int32
			_, err := m.Start("stop", func(context.Context, Target) Sample {
				calls.Add(1)
				return Sample{Status: status}
			})
			require.NoError(t, err)
			s := waitComplete(t, m, "stop")
			require.EqualValues(t, len(targets), calls.Load())
			for _, r := range s.Results {
				require.Equal(t, status, r.Status)
				require.Equal(t, "complete", r.Phase)
				require.Empty(t, r.Samples)
			}
		})
	}
}
func TestTargetNeverHasOverlappingSamplesAndPartialResultsArePublished(t *testing.T) {
	m := NewManager()
	var mu sync.Mutex
	inflight := map[string]int{}
	var overlap atomic.Bool
	release := make(chan struct{})
	var once sync.Once
	defer once.Do(func() { close(release) })
	_, err := m.Start("partial", func(ctx context.Context, target Target) Sample {
		mu.Lock()
		inflight[target.ID]++
		if inflight[target.ID] > 1 {
			overlap.Store(true)
		}
		mu.Unlock()
		defer func() { mu.Lock(); inflight[target.ID]--; mu.Unlock() }()
		if len(m.Get("partial").Results[0].Samples) > 0 {
			select {
			case <-release:
			case <-ctx.Done():
			}
		}
		v := 9.5
		return Sample{Status: "ok", DelayMS: &v}
	})
	require.NoError(t, err)
	require.Eventually(t, func() bool {
		s := m.Get("partial")
		return s.Results[0].DelayMS != nil && s.State == "running"
	}, time.Second, time.Millisecond)
	s := m.Get("partial")
	require.Equal(t, "ok", s.Results[0].Status)
	require.Equal(t, 9.5, *s.Results[0].DelayMS)
	once.Do(func() { close(release) })
	waitComplete(t, m, "partial")
	require.False(t, overlap.Load())
}

func TestTimedOutTargetsStillReceiveFiveAttemptsAfterEveryFirstAttempt(t *testing.T) {
	m := NewManager()
	m.workers = 1
	var order []string
	_, err := m.Start("timeouts", func(context.Context, Target) Sample {
		// The ordered dispatcher test above validates IDs; here count every timeout.
		order = append(order, "timeout")
		return Sample{Status: "timeout"}
	})
	require.NoError(t, err)
	s := waitComplete(t, m, "timeouts")
	require.Len(t, order, len(targets)*(MeasuredRounds+WarmupRounds))
	for _, r := range s.Results {
		require.Equal(t, "complete", r.Phase)
		require.Equal(t, "timeout", r.Status)
		require.Len(t, r.Samples, MeasuredRounds)
	}
}
