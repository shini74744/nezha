// Package connectivity manages bounded, on-demand node probes. It never dials
// targets itself: only the supplied Agent probe function may perform network I/O.
package connectivity

import (
	"context"
	"errors"
	"sort"
	"sync"
	"time"
)

type Target struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Group string `json:"group"`
	Host  string `json:"host"`
	URL   string `json:"-"`
}

// Keep this list server-owned. The public API must never accept URLs, ports,
// methods, headers or commands from a browser.
var targets = []Target{
	{"google", "Google", "global", "www.google.com", "https://www.google.com/generate_204"},
	{"youtube", "YouTube", "global", "www.youtube.com", "https://www.youtube.com/generate_204"},
	{"cloudflare", "Cloudflare", "global", "www.cloudflare.com", "https://www.cloudflare.com/cdn-cgi/trace"},
	{"github", "GitHub", "global", "github.com", "https://github.com/favicon.ico"},
	{"microsoft", "Microsoft", "global", "www.microsoft.com", "https://www.microsoft.com/favicon.ico"},
	{"wikipedia", "Wikipedia", "global", "www.wikipedia.org", "https://www.wikipedia.org/favicon.ico"},
	{"telegram", "Telegram", "global", "telegram.org", "https://telegram.org/favicon.ico"},
	{"openai", "OpenAI", "global", "openai.com", "https://openai.com/favicon.ico"},
	{"netflix", "Netflix", "global", "www.netflix.com", "https://www.netflix.com/favicon.ico"},
	{"baidu", "百度", "china", "www.baidu.com", "https://www.baidu.com/favicon.ico"},
	{"bilibili", "哔哩哔哩", "china", "www.bilibili.com", "https://www.bilibili.com/favicon.ico"},
	{"qq", "腾讯", "china", "www.qq.com", "https://www.qq.com/favicon.ico"},
}

func Targets() []Target { return append([]Target(nil), targets...) }
func FindTarget(id string) (Target, bool) {
	for _, target := range targets {
		if target.ID == id {
			return target, true
		}
	}
	return Target{}, false
}

type Sample struct {
	Status     string   `json:"status"`
	DelayMS    *float64 `json:"delay_ms,omitempty"`
	HTTPStatus int      `json:"http_status,omitempty"`
}
type Result struct {
	Target
	Status  string   `json:"status"`
	Samples []Sample `json:"samples"`
	DelayMS *float64 `json:"delay_ms,omitempty"`
}
type Snapshot struct {
	State      string   `json:"state"`
	StartedAt  int64    `json:"started_at,omitempty"`
	FinishedAt int64    `json:"finished_at,omitempty"`
	RetryAt    int64    `json:"retry_at,omitempty"`
	Rounds     int      `json:"rounds"`
	Results    []Result `json:"results"`
}
type Probe func(context.Context, Target) Sample
type entry struct {
	snapshot Snapshot
	touched  time.Time
}
type Manager struct {
	mu         sync.Mutex
	entries    map[string]*entry
	active     int
	now        func() time.Time
	maxActive  int
	maxEntries int
	ttl        time.Duration
	cooldown   time.Duration
	rounds     int
	workers    int
	timeout    time.Duration
}

var ErrBusy = errors.New("connectivity_busy")

func NewManager() *Manager {
	return &Manager{entries: map[string]*entry{}, now: time.Now, maxActive: 4,
		maxEntries: 512, ttl: 24 * time.Hour, cooldown: time.Minute, rounds: 3,
		workers: 4, timeout: 6 * time.Minute}
}
func empty(rounds int) Snapshot {
	snapshot := Snapshot{State: "idle", Rounds: rounds, Results: make([]Result, len(targets))}
	for i, t := range targets {
		snapshot.Results[i] = Result{Target: t, Status: "pending", Samples: []Sample{}}
	}
	return snapshot
}
func clone(s Snapshot) Snapshot {
	s.Results = append([]Result(nil), s.Results...)
	for i := range s.Results {
		s.Results[i].Samples = append([]Sample{}, s.Results[i].Samples...)
	}
	return s
}
func (m *Manager) Get(key string) Snapshot {
	m.mu.Lock()
	defer m.mu.Unlock()
	if e := m.entries[key]; e != nil {
		if e.snapshot.State == "running" || m.now().Sub(e.touched) < m.ttl {
			return clone(e.snapshot)
		}
		delete(m.entries, key)
	}
	return empty(m.rounds)
}

// Start deduplicates requests for the same identity and never queues unbounded work.
// Jobs intentionally outlive an individual page/request, so viewers share one run.
func (m *Manager) Start(key string, probe Probe) (Snapshot, error) {
	m.mu.Lock()
	now := m.now()
	if e := m.entries[key]; e != nil && (e.snapshot.State == "running" || now.UnixMilli() < e.snapshot.RetryAt) {
		snapshot := clone(e.snapshot)
		m.mu.Unlock()
		return snapshot, nil
	}
	if m.active >= m.maxActive {
		m.mu.Unlock()
		return Snapshot{}, ErrBusy
	}
	for k, e := range m.entries {
		if e.snapshot.State != "running" && now.Sub(e.touched) >= m.ttl {
			delete(m.entries, k)
		}
	}
	if len(m.entries) >= m.maxEntries && m.entries[key] == nil {
		var oldest string
		var at time.Time
		for k, e := range m.entries {
			// Never evict an active/cooldown entry: this would bypass the per-node limit.
			if e.snapshot.State != "running" && e.snapshot.RetryAt <= now.UnixMilli() && (oldest == "" || e.touched.Before(at)) {
				oldest = k
				at = e.touched
			}
		}
		if oldest == "" {
			m.mu.Unlock()
			return Snapshot{}, ErrBusy
		}
		delete(m.entries, oldest)
	}
	s := empty(m.rounds)
	s.State = "running"
	s.StartedAt = now.UnixMilli()
	e := &entry{snapshot: s, touched: now}
	m.entries[key] = e
	m.active++
	snapshot := clone(s)
	m.mu.Unlock()
	go m.run(e, probe)
	return snapshot, nil
}
func (m *Manager) run(e *entry, probe Probe) {
	ctx, cancel := context.WithTimeout(context.Background(), m.timeout)
	defer cancel()
	jobs := make(chan int, len(targets))
	for i := range targets {
		jobs <- i
	}
	close(jobs)
	var wg sync.WaitGroup
	for worker := 0; worker < m.workers; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobs {
				for round := 0; round < m.rounds; round++ {
					sample := Sample{Status: "agent_timeout"}
					if ctx.Err() == nil {
						sample = probe(ctx, targets[i])
					}
					m.mu.Lock()
					r := &e.snapshot.Results[i]
					r.Samples = append(r.Samples, sample)
					r.Status = "running"
					if len(r.Samples) == m.rounds {
						summarize(r)
					}
					m.mu.Unlock()
				}
			}
		}()
	}
	wg.Wait()
	m.mu.Lock()
	defer m.mu.Unlock()
	e.snapshot.State = "complete"
	e.snapshot.FinishedAt = m.now().UnixMilli()
	e.snapshot.RetryAt = m.now().Add(m.cooldown).UnixMilli()
	e.touched = m.now()
	m.active--
}
func summarize(r *Result) {
	r.Status = r.Samples[0].Status
	var delays []float64
	for _, s := range r.Samples {
		if s.Status != r.Status {
			r.Status = "unstable"
		}
		if s.DelayMS != nil {
			delays = append(delays, *s.DelayMS)
		}
	}
	if len(delays) > 0 {
		sort.Float64s(delays)
		value := delays[len(delays)/2]
		if len(delays)%2 == 0 {
			value = (delays[len(delays)/2-1] + value) / 2
		}
		r.DelayMS = &value
	}
}
