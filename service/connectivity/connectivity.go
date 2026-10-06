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

// ProbeTimeout bounds the dashboard wait for a single Agent attempt.
const ProbeTimeout = 3 * time.Second

type Target struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Group string `json:"group"`
	Host  string `json:"host"`
	URL   string `json:"-"`
	Icon  string `json:"icon"`
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
	Phase   string   `json:"phase,omitempty"`
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
		workers: 12, timeout: 2 * time.Minute}
}
func empty(rounds int, selected ...[]Target) Snapshot {
	targets := selectedTargets(selected)
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
func (m *Manager) Get(key string, selected ...[]Target) Snapshot {
	m.mu.Lock()
	defer m.mu.Unlock()
	if e := m.entries[key]; e != nil {
		if e.snapshot.State == "running" || m.now().Sub(e.touched) < m.ttl {
			return reconcile(e.snapshot, selectedTargets(selected))
		}
		delete(m.entries, key)
	}
	return empty(m.rounds, selectedTargets(selected))
}

// Start deduplicates requests for the same identity and never queues unbounded work.
// Jobs intentionally outlive an individual page/request, so viewers share one run.
func (m *Manager) Start(key string, probe Probe, selected ...[]Target) (Snapshot, error) {
	targets := append([]Target(nil), selectedTargets(selected)...)
	if len(targets) == 0 {
		return empty(m.rounds, targets), errors.New("connectivity_no_targets")
	}
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
	s := empty(m.rounds, targets)
	s.State = "running"
	for i := range s.Results {
		s.Results[i].Phase = "queued"
	}
	s.StartedAt = now.UnixMilli()
	e := &entry{snapshot: s, touched: now}
	m.entries[key] = e
	m.active++
	snapshot := clone(s)
	m.mu.Unlock()
	go m.run(e, probe, targets)
	return snapshot, nil
}

// Interleave regions so a slow region cannot occupy the entire first wave.
func initialQueue(selected ...[]Target) []int {
	targets := selectedTargets(selected)
	groups := []string{}
	byGroup := map[string][]int{}
	for i, target := range targets {
		if _, exists := byGroup[target.Group]; !exists {
			groups = append(groups, target.Group)
		}
		byGroup[target.Group] = append(byGroup[target.Group], i)
	}
	queue := make([]int, 0, len(targets))
	for len(queue) < len(targets) {
		for _, group := range groups {
			if len(byGroup[group]) > 0 {
				queue = append(queue, byGroup[group][0])
				byGroup[group] = byGroup[group][1:]
			}
		}
	}
	return queue
}

func stopSampling(status string) bool {
	switch status {
	case "offline", "query_disabled":
		return true
	}
	return false
}

func (m *Manager) run(e *entry, probe Probe, targets []Target) {
	ctx, cancel := context.WithTimeout(context.Background(), m.timeout)
	defer cancel()
	type completion struct {
		index  int
		sample Sample
	}
	jobs := make(chan int)
	finished := make(chan completion, m.workers)
	var wg sync.WaitGroup
	for worker := 0; worker < m.workers; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobs {
				// Publish the active phase BEFORE waiting for the first response.
				m.mu.Lock()
				e.snapshot.Results[i].Phase = "running"
				m.mu.Unlock()
				finished <- completion{i, probe(ctx, targets[i])}
			}
		}()
	}
	queue := initialQueue(targets)
	active := 0
	deadline := ctx.Done()
	for len(queue) > 0 || active > 0 {
		var dispatch chan<- int
		var next int
		if ctx.Err() == nil && len(queue) > 0 && active < m.workers {
			dispatch, next = jobs, queue[0]
		}
		select {
		case dispatch <- next:
			queue = queue[1:]
			active++
		case done := <-finished:
			active--
			m.mu.Lock()
			r := &e.snapshot.Results[done.index]
			r.Samples = append(r.Samples, done.sample)
			summarize(r) // Surface partial responses immediately, not after all rounds.
			r.Phase = "complete"
			if ctx.Err() == nil && len(r.Samples) < m.rounds && !stopSampling(done.sample.Status) {
				r.Phase = "queued"
				// Retries go behind all unstarted sites; no target has two in-flight probes.
				queue = append(queue, done.index)
			}
			m.mu.Unlock()
		case <-deadline:
			m.mu.Lock()
			for _, i := range queue {
				r := &e.snapshot.Results[i]
				r.Phase, r.Status = "complete", "batch_timeout"
				// Never fabricate samples for probes that were not dispatched.
			}
			m.mu.Unlock()
			queue = nil
			deadline = nil
		}
	}
	close(jobs)
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
func selectedTargets(selected [][]Target) []Target {
	if len(selected) > 0 {
		return selected[0]
	}
	return targets
}

// In-flight batches retain their immutable catalog. Afterwards render the latest
// order/labels, retaining samples only when the target identity AND URL match.
// New/edited endpoints stay pending until an authorized user starts another run.
// RetryAt survives edits: changing settings cannot bypass per-node cooldown.
func reconcile(source Snapshot, current []Target) Snapshot {
	if source.State == "running" {
		return clone(source)
	}
	snapshot := source
	snapshot.Results = make([]Result, 0, len(current))
	byID := map[string]Result{}
	for _, result := range source.Results {
		byID[result.ID] = result
	}
	changed := false
	for _, target := range current {
		old, ok := byID[target.ID]
		if ok && old.URL == target.URL {
			old.Target = target
			old.Samples = append([]Sample{}, old.Samples...)
			snapshot.Results = append(snapshot.Results, old)
		} else {
			changed = true
			snapshot.Results = append(snapshot.Results, Result{Target: target, Status: "pending", Samples: []Sample{}})
		}
	}
	if changed {
		snapshot.State = "idle"
		snapshot.StartedAt = 0
		snapshot.FinishedAt = 0
	}
	return snapshot
}
