package connectivity

import (
	"errors"
	"sort"
	"time"
)

var ErrNotReady = errors.New("connectivity_not_ready")

type Candidate struct {
	Key string
	ID  uint64
}
type Scheduler struct {
	next   map[string]time.Time
	policy Policy
}

func (s *Scheduler) Tick(now time.Time, p Policy, nodes []Candidate, lastFull func(string) (int64, error), start func(Candidate) error) error {
	if s.next == nil || s.policy != p {
		s.next = map[string]time.Time{}
		s.policy = p
	}
	if !p.Enabled {
		return nil
	}
	known := map[string]bool{}
	for _, node := range nodes {
		known[node.Key] = true
		if _, ok := s.next[node.Key]; !ok {
			s.next[node.Key] = ClockSlot(now, p.IntervalHours).Add(time.Duration(node.ID%8) * 15 * time.Second)
		}
	}
	for key := range s.next {
		if !known[key] {
			delete(s.next, key)
		}
	}
	ordered := append([]Candidate(nil), nodes...)
	sort.Slice(ordered, func(i, j int) bool {
		a, b := s.next[ordered[i].Key], s.next[ordered[j].Key]
		if a.Equal(b) {
			return ordered[i].ID < ordered[j].ID
		}
		return a.Before(b)
	})
	for _, node := range ordered {
		if now.Before(s.next[node.Key]) {
			continue
		}
		last, err := lastFull(node.Key)
		if err != nil {
			return err
		}
		due := NextClockSlot(time.UnixMilli(last), p.IntervalHours)
		if last > 0 && now.Before(due) {
			s.next[node.Key] = due
			continue
		}
		err = start(node)
		if errors.Is(err, ErrNotReady) {
			continue
		}
		if errors.Is(err, ErrBusy) {
			return nil
		}
		if err != nil {
			return err
		}
		s.next[node.Key] = NextClockSlot(now, p.IntervalHours)
		return nil // At most one new node per tick.
	}
	return nil
}
