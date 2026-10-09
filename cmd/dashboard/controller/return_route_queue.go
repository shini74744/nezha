package controller

import (
	"errors"
	"sync"
	"time"
)

// Bound probe concurrency, not administrator retest frequency. One ticket per
// server prevents automatic/manual or identity-change overlap. Waiting work is
// bounded by the managed server inventory rather than a number of clicks.
type returnRouteQueue struct {
	mu               sync.Mutex
	capacity, active int
	tickets          map[uint64]*returnRouteTicket
	waiting          []*returnRouteTicket
}
type returnRouteTicket struct {
	queue    *returnRouteQueue
	serverID uint64
	key      string
	manual   bool
	policy   string
	ready    chan struct{}
	started  bool
	once     sync.Once
}

func newReturnRouteQueue(capacity int) *returnRouteQueue {
	return &returnRouteQueue{capacity: capacity, tickets: map[uint64]*returnRouteTicket{}}
}

var returnRoutes = newReturnRouteQueue(3)

func (q *returnRouteQueue) reserve(id uint64, key string, manual bool, policy ...string) (*returnRouteTicket, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if previous := q.tickets[id]; previous != nil {
		return nil, errors.New("节点旧任务正在结束，请稍后重试")
	}
	t := &returnRouteTicket{queue: q, serverID: id, key: key, manual: manual, ready: make(chan struct{})}
	if len(policy) > 0 {
		t.policy = policy[0]
	}
	q.tickets[id] = t
	if q.active < q.capacity {
		q.active++
		t.started = true
		close(t.ready)
	} else {
		q.waiting = append(q.waiting, t)
	}
	return t, nil
}
func (q *returnRouteQueue) promote(key string) {
	q.mu.Lock()
	defer q.mu.Unlock()
	for _, t := range q.tickets {
		if t.key == key {
			t.manual = true
			return
		}
	}
}
func (t *returnRouteTicket) isManual() bool {
	t.queue.mu.Lock()
	defer t.queue.mu.Unlock()
	return t.manual
}
func (t *returnRouteTicket) isReady() bool {
	select {
	case <-t.ready:
		return true
	default:
		return false
	}
}
func (t *returnRouteTicket) wait(valid func() bool) bool {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-t.ready:
			return valid()
		case <-ticker.C:
			if !valid() {
				return false
			}
		}
	}
}
func (t *returnRouteTicket) done() {
	t.once.Do(func() {
		q := t.queue
		q.mu.Lock()
		defer q.mu.Unlock()
		delete(q.tickets, t.serverID)
		if !t.started {
			for i, v := range q.waiting {
				if v == t {
					q.waiting = append(q.waiting[:i], q.waiting[i+1:]...)
					break
				}
			}
			return
		}
		q.active--
		if len(q.waiting) == 0 {
			return
		}
		// FIFO within each priority. Manual demand goes ahead of scheduled work.
		next := 0
		for i, v := range q.waiting {
			if v.manual {
				next = i
				break
			}
		}
		v := q.waiting[next]
		q.waiting = append(q.waiting[:next], q.waiting[next+1:]...)
		q.active++
		v.started = true
		close(v.ready)
	})
}
func (q *returnRouteQueue) position(key string) int {
	q.mu.Lock()
	defer q.mu.Unlock()
	ordered := make([]*returnRouteTicket, 0, len(q.waiting))
	for _, v := range q.waiting {
		if v.manual {
			ordered = append(ordered, v)
		}
	}
	for _, v := range q.waiting {
		if !v.manual {
			ordered = append(ordered, v)
		}
	}
	for i, v := range ordered {
		if v.key == key {
			return i + 1
		}
	}
	return 0
}

func (q *returnRouteQueue) policyMatches(key, expected string) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	for _, t := range q.tickets {
		if t.key == key {
			return t.policy == expected
		}
	}
	return false
}
