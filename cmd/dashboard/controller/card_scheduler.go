package controller

import (
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/connectivity"
	"github.com/nezhahq/nezha/service/networkinsight"
	"github.com/nezhahq/nezha/service/rpc"
	"github.com/nezhahq/nezha/service/singleton"
	"sort"
	"time"
)

type cardCandidate struct {
	server         *model.Server
	kind, identity string
	slot, last     int64
}
type cardScheduler struct {
	cleaned time.Time
	// Optional dispatch seam for deterministic scheduler tests; production uses launchInsight/StartScheduled.
	start func(cardCandidate, []connectivity.Target) error
}

func sortCardCandidates(items []cardCandidate, order []string) {
	rank := map[string]int{}
	for i, kind := range order {
		rank[kind] = i
	}
	sort.SliceStable(items, func(i, j int) bool {
		a, b := items[i], items[j]
		if a.slot != b.slot {
			return a.slot < b.slot
		}
		if rank[a.kind] != rank[b.kind] {
			return rank[a.kind] < rank[b.kind]
		}
		if a.last != b.last {
			return a.last < b.last
		}
		return a.server.ID < b.server.ID
	})
}

// One automatic task per node; a queued return trace also reserves its node.
// Existing manual work is respected, without introducing a manual cooldown.
func cardNodeBusy(s *model.Server, identity string) bool {
	if connectivityManager.Get(connectivityKey(s), nil).State == "running" {
		return true
	}
	insightJobs.Lock()
	defer insightJobs.Unlock()
	for _, kind := range []string{"bgp", "return-route", "streaming"} {
		if _, ok := insightJobs.values[identity+kind]; ok {
			return true
		}
	}
	return false
}
func dispatchCardCandidates(items []cardCandidate, order []string, busy func(cardCandidate) bool, start func(cardCandidate) error) int {
	sortCardCandidates(items, order)
	blocked := map[uint64]bool{}
	dispatched := 0
	for _, v := range items {
		if blocked[v.server.ID] {
			continue
		}
		// A due higher-priority job that cannot acquire capacity keeps its place.
		blocked[v.server.ID] = true
		if busy(v) {
			continue
		}
		if start(v) == nil {
			dispatched++
			if dispatched >= 3 {
				break
			}
		}
	}
	return dispatched
}
func (scheduler *cardScheduler) tick(now time.Time) error {
	settingsMutationMu.Lock()
	priority, err := networkinsight.ReadDetectionPriority(singleton.DB)
	settingsMutationMu.Unlock()
	if err != nil {
		return err
	}
	policies := map[string]connectivity.Policy{}
	for _, kind := range priority.Order {
		policyKind := kind
		if kind == "connectivity" {
			policyKind = "streaming"
		}
		p, e := insightPolicy(policyKind)
		if e != nil {
			return e
		}
		policies[kind] = p
		switch kind {
		case "connectivity":
			connectivityAutoEnabled.Store(p.Enabled)
			connectivityManager.SetRetention(time.Duration(p.RetentionDays) * 24 * time.Hour)
		case "bgp":
			bgpAutoEnabled.Store(p.Enabled)
		case "return-route":
			returnRouteAutoEnabled.Store(p.Enabled)
		}
	}
	store := connectivity.Store{DB: singleton.DB}
	if now.Sub(scheduler.cleaned) >= time.Minute {
		if err = store.Prune(now, policies["connectivity"]); err != nil {
			return err
		}
		for _, kind := range []string{"bgp", "return-route", "streaming"} {
			if err = pruneInsight(kind, policies[kind], now); err != nil {
				return err
			}
		}
		scheduler.cleaned = now
	}
	var targets []connectivity.Target
	if policies["connectivity"].Enabled {
		targets, err = configuredConnectivityTargets()
		if err != nil {
			return err
		}
	}
	candidates := []cardCandidate{}
	var readErr error
	singleton.ServerShared.Range(func(_ uint64, s *model.Server) bool {
		if s == nil || !rpc.ConnectivityOnline(s) {
			return true
		}
		identity, _, e := insightIdentity(s)
		if e != nil {
			readErr = e
			return false
		}
		for _, kind := range priority.Order {
			p := policies[kind]
			if !p.Enabled {
				continue
			}
			slot := insightClockSlot(kind, now, p.IntervalHours).UnixMilli()
			if kind == "connectivity" {
				if s.ConnectivityDisabled || len(targets) == 0 {
					continue
				}
				slot = connectivity.ClockSlot(now, p.IntervalHours).UnixMilli()
				last, e := store.LastFull(connectivityKey(s))
				if e != nil {
					readErr = e
					return false
				}
				if last >= slot {
					continue
				}
				current := connectivityCached(connectivityKey(s), targets)
				if now.UnixMilli() < current.RetryAt {
					continue
				}
				candidates = append(candidates, cardCandidate{s, kind, identity, slot, last})
			} else {
				if !insightEnabled(s, kind) {
					continue
				}
				var row networkinsight.Record
				if e = singleton.DB.Where("identity = ? AND kind = ? AND scheduled_at > 0", identity, kind).Order("scheduled_at DESC, finished_at DESC").Limit(1).Find(&row).Error; e != nil {
					readErr = e
					return false
				}
				if row.ScheduledAt >= slot && !(kind == "bgp" && bgpRetryReady(row, slot, now.UnixMilli())) {
					continue
				}
				candidates = append(candidates, cardCandidate{s, kind, identity, slot, row.FinishedAt})
			}
		}
		return true
	})
	if readErr != nil {
		return readErr
	}
	dispatchCardCandidates(candidates, priority.Order, func(v cardCandidate) bool {
		return cardNodeBusy(v.server, v.identity)
	}, func(v cardCandidate) error {
		current, ok := singleton.ServerShared.Get(v.server.ID)
		if !ok || connectivityKey(current) != connectivityKey(v.server) || !rpc.ConnectivityOnline(current) {
			return connectivity.ErrNotReady
		}
		if scheduler.start != nil {
			return scheduler.start(v, targets)
		}
		if v.kind != "connectivity" {
			return launchInsight(current, v.kind, true)
		}
		if current.ConnectivityDisabled {
			return connectivity.ErrNotReady
		}
		_, err := connectivityManager.StartScheduled(connectivityKey(current), guardedConnectivityProbe(current, targets, true), targets, v.slot)
		return err
	})
	return nil
}
