package singleton

import (
	"context"
	"sync"
	"time"

	"github.com/nezhahq/nezha/model"
)

// Only active RPCs own subscriptions. No log history or credentials are cached.
var sshReadWakeups = struct {
	sync.Mutex
	listeners map[string]map[chan struct{}]struct{}
}{listeners: make(map[string]map[chan struct{}]struct{})}

func signalSSHRead(uuid string) {
	sshReadWakeups.Lock()
	defer sshReadWakeups.Unlock()
	for ch := range sshReadWakeups.listeners[uuid] {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

func pendingSSHReads(uuid string, now time.Time) (uint64, *model.SSHBanQuery) {
	var id uint64
	sshLocal.Lock()
	if q := sshLocal.requests[uuid]; q != nil && now.Before(q.expires) {
		id = q.id
	}
	sshLocal.Unlock()
	var query *model.SSHBanQuery
	sshBanLocal.Lock()
	for _, q := range sshBanLocal.requests[uuid] {
		if now.Before(q.expires) {
			copy := q.query
			query = &copy
			break
		}
	}
	sshBanLocal.Unlock()
	return id, query
}

// Existing Agents give this RPC a 10-second deadline and collect logs separately.
// Wait outside the policy/database locks, leaving 2 seconds for the response.
// A browser read wakes the response immediately, instead of waiting for a new report.
func WaitSSHLocalReads(ctx context.Context, uuid string, reply *model.SSHLoginReply) {
	if reply.QueryID != 0 || reply.BanQuery != nil {
		return
	}
	deadline, ok := ctx.Deadline()
	if !ok {
		return
	}
	budget := min(8*time.Second, time.Until(deadline)-2*time.Second)
	if budget <= 0 {
		return
	}
	ch := make(chan struct{}, 1)
	sshReadWakeups.Lock()
	if sshReadWakeups.listeners[uuid] == nil {
		sshReadWakeups.listeners[uuid] = make(map[chan struct{}]struct{})
	}
	sshReadWakeups.listeners[uuid][ch] = struct{}{}
	sshReadWakeups.Unlock()
	defer func() {
		sshReadWakeups.Lock()
		delete(sshReadWakeups.listeners[uuid], ch)
		if len(sshReadWakeups.listeners[uuid]) == 0 {
			delete(sshReadWakeups.listeners, uuid)
		}
		sshReadWakeups.Unlock()
	}()
	timer := time.NewTimer(budget)
	defer timer.Stop()
	for {
		// Subscribe before checking, so an enqueue cannot fall between the two.
		reply.QueryID, reply.BanQuery = pendingSSHReads(uuid, time.Now())
		if reply.QueryID != 0 || reply.BanQuery != nil {
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			return
		case <-ch:
		}
	}
}
