package singleton

import (
	"context"
	"fmt"
	"github.com/nezhahq/nezha/model"
	"sync"
	"sync/atomic"
	"time"
)

// Snapshots are transient observations, never a database-backed ban authority.
var sshLocal struct {
	sync.Mutex
	states   map[string]model.SSHLoginStatus
	requests map[string]*sshLocalRequest
}

type sshLocalRequest struct {
	id      uint64
	done    chan struct{}
	events  []model.SSHLoginEvent
	expires time.Time
	waiters int
}

var sshQuerySequence atomic.Uint64

func SSHLoginStatusFor(uuid string) model.SSHLoginStatus {
	sshLocal.Lock()
	defer sshLocal.Unlock()
	return sshLocal.states[uuid]
}
func observeSSHLocal(uuid string, r model.SSHLoginReport, now time.Time) uint64 {
	sshLocal.Lock()
	defer sshLocal.Unlock()
	if sshLocal.states == nil {
		sshLocal.states = map[string]model.SSHLoginStatus{}
	}
	st := r.Status
	st.UUID = uuid
	st.UpdatedAt = now.Unix()
	sshLocal.states[uuid] = st
	for key, v := range sshLocal.states {
		if now.Unix()-v.UpdatedAt > 86400 {
			delete(sshLocal.states, key)
		}
	}
	for key, q := range sshLocal.requests {
		if now.After(q.expires) {
			delete(sshLocal.requests, key)
		}
	}
	if q := sshLocal.requests[uuid]; q != nil {
		if q.id == r.QueryID {
			q.events = append([]model.SSHLoginEvent{}, r.Recent...)
			delete(sshLocal.requests, uuid)
			close(q.done)
			return 0
		}
		return q.id
	}
	return 0
}
func ReadSSHLocalEvents(ctx context.Context, uuid string) ([]model.SSHLoginEvent, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	sshLocal.Lock()
	st := sshLocal.states[uuid]
	if st.UpdatedAt == 0 || time.Now().Unix()-st.UpdatedAt > 45 {
		sshLocal.Unlock()
		return nil, fmt.Errorf("Agent 暂未连接，无法读取本机记录")
	}
	if sshLocal.requests == nil {
		sshLocal.requests = map[string]*sshLocalRequest{}
	}
	q := sshLocal.requests[uuid]
	if q == nil || time.Now().After(q.expires) {
		q = &sshLocalRequest{id: sshQuerySequence.Add(1), done: make(chan struct{}), expires: time.Now().Add(25 * time.Second)}
		sshLocal.requests[uuid] = q
	}
	q.waiters++
	sshLocal.Unlock()
	signalSSHRead(uuid)
	defer func() {
		sshLocal.Lock()
		q.waiters--
		if q.waiters == 0 && sshLocal.requests[uuid] == q {
			delete(sshLocal.requests, uuid)
		}
		sshLocal.Unlock()
	}()

	timer := time.NewTimer(25 * time.Second)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-timer.C:
		return nil, fmt.Errorf("读取本机记录超时，请重试")
	case <-q.done:
		return q.events, nil
	}
}
