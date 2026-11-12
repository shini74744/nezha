package singleton

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
)

func hasSSHListener(uuid string) bool {
	sshReadWakeups.Lock()
	defer sshReadWakeups.Unlock()
	return len(sshReadWakeups.listeners[uuid]) > 0
}

func TestSSHReadWakesIdleReportWithoutNextHeartbeat(t *testing.T) {
	for _, kind := range []string{"events", "bans"} {
		t.Run(kind, func(t *testing.T) {
			uuid := "wake-" + kind
			observeSSHLocal(uuid, model.SSHLoginReport{Status: model.SSHLoginStatus{BanPaging: true}}, time.Now())
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			replies := make(chan model.SSHLoginReply, 1)
			go func() { reply := model.SSHLoginReply{}; WaitSSHLocalReads(ctx, uuid, &reply); replies <- reply }()
			require.Eventually(t, func() bool { return hasSSHListener(uuid) }, time.Second, time.Millisecond)
			// A different node cannot wake this node or deliver its query.
			signalSSHRead("other")
			select {
			case <-replies:
				t.Fatal("cross-node wakeup")
			default:
			}
			completed := make(chan error, 1)
			start := time.Now()
			go func() {
				if kind == "events" {
					_, err := ReadSSHLocalEvents(ctx, uuid)
					completed <- err
				} else {
					_, err := ReadSSHLocalBans(ctx, uuid, "198.18", 53, 100)
					completed <- err
				}
			}()
			var reply model.SSHLoginReply
			select {
			case reply = <-replies:
			case <-time.After(time.Second):
				t.Fatal("query waited for the next heartbeat")
			}
			if kind == "events" {
				require.NotZero(t, reply.QueryID)
				observeSSHLocal(uuid, model.SSHLoginReport{QueryID: reply.QueryID, Recent: []model.SSHLoginEvent{{ID: "fresh"}}}, time.Now())
			} else {
				require.NotNil(t, reply.BanQuery)
				require.Equal(t, 53, reply.BanQuery.Page)
				observeSSHBans(uuid, &model.SSHBanPage{QueryID: reply.BanQuery.ID, Page: 53, PageSize: 100, Total: 5259, Items: []model.SSHBanEntry{}, Complete: true}, time.Now())
			}
			require.NoError(t, <-completed)
			require.Less(t, time.Since(start), time.Second)
			require.False(t, hasSSHListener(uuid))
			t.Logf("read and response: %s", time.Since(start))
		})
	}
}

func TestSSHReadAlreadyQueuedAndDeadlineCleanup(t *testing.T) {
	uuid := "wake-queued"
	observeSSHLocal(uuid, model.SSHLoginReport{}, time.Now())
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { _, e := ReadSSHLocalEvents(ctx, uuid); done <- e }()
	require.Eventually(t, func() bool { id, _ := pendingSSHReads(uuid, time.Now()); return id != 0 }, time.Second, time.Millisecond)
	rpcCtx, rpcCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer rpcCancel()
	reply := model.SSHLoginReply{}
	WaitSSHLocalReads(rpcCtx, uuid, &reply)
	require.NotZero(t, reply.QueryID)
	cancel()
	require.ErrorIs(t, <-done, context.Canceled)
	id, _ := pendingSSHReads(uuid, time.Now())
	require.Zero(t, id)

	ctx2, cancel2 := context.WithTimeout(context.Background(), 2050*time.Millisecond)
	defer cancel2()
	start := time.Now()
	WaitSSHLocalReads(ctx2, "no-reader", &model.SSHLoginReply{})
	require.Less(t, time.Since(start), 500*time.Millisecond, "response budget must retain deadline margin")
	require.False(t, hasSSHListener("no-reader"))

	ctx3, cancel3 := context.WithTimeout(context.Background(), 10*time.Second)
	exited := make(chan struct{})
	go func() { WaitSSHLocalReads(ctx3, "cancel-report", &model.SSHLoginReply{}); close(exited) }()
	require.Eventually(t, func() bool { return hasSSHListener("cancel-report") }, time.Second, time.Millisecond)
	cancel3()
	select {
	case <-exited:
	case <-time.After(time.Second):
		t.Fatal("cancelled RPC leaked")
	}
	require.False(t, hasSSHListener("cancel-report"))
}

func TestSSHReadCancellationRemovesSupersededPages(t *testing.T) {
	uuid := "cancel-pages"
	observeSSHLocal(uuid, model.SSHLoginReport{Status: model.SSHLoginStatus{BanPaging: true}}, time.Now())
	for i := 1; i <= 20; i++ {
		ctx, cancel := context.WithCancel(context.Background())
		done := make(chan error, 1)
		go func(page int) { _, e := ReadSSHLocalBans(ctx, uuid, "", page, 100); done <- e }(i)
		require.Eventually(t, func() bool { _, q := pendingSSHReads(uuid, time.Now()); return q != nil }, time.Second, time.Millisecond)
		cancel()
		require.ErrorIs(t, <-done, context.Canceled)
		_, q := pendingSSHReads(uuid, time.Now())
		require.Nil(t, q, fmt.Sprintf("page %d stayed queued", i))
	}
}

func TestSSHReadSharedWaiterSurvivesOtherReaderCancellation(t *testing.T) {
	for _, kind := range []string{"events", "bans"} {
		t.Run(kind, func(t *testing.T) {
			uuid := "shared-" + kind
			observeSSHLocal(uuid, model.SSHLoginReport{Status: model.SSHLoginStatus{BanPaging: true}}, time.Now())
			ctx1, cancel1 := context.WithCancel(context.Background())
			defer cancel1()
			ctx2, cancel2 := context.WithCancel(context.Background())
			defer cancel2()
			d1, d2 := make(chan error, 1), make(chan error, 1)
			read := func(ctx context.Context, ch chan error) {
				if kind == "events" {
					_, e := ReadSSHLocalEvents(ctx, uuid)
					ch <- e
				} else {
					_, e := ReadSSHLocalBans(ctx, uuid, "", 1, 20)
					ch <- e
				}
			}
			go read(ctx1, d1)
			go read(ctx2, d2)
			require.Eventually(t, func() bool {
				if kind == "events" {
					sshLocal.Lock()
					defer sshLocal.Unlock()
					q := sshLocal.requests[uuid]
					return q != nil && q.waiters == 2
				}
				sshBanLocal.Lock()
				defer sshBanLocal.Unlock()
				q := sshBanLocal.requests[uuid]
				return len(q) == 1 && q[0].waiters == 2
			}, time.Second, time.Millisecond)
			cancel1()
			require.ErrorIs(t, <-d1, context.Canceled)
			id, q := pendingSSHReads(uuid, time.Now())
			if kind == "events" {
				require.NotZero(t, id)
				observeSSHLocal(uuid, model.SSHLoginReport{QueryID: id}, time.Now())
			} else {
				require.NotNil(t, q)
				observeSSHBans(uuid, &model.SSHBanPage{QueryID: q.ID, Page: 1, PageSize: 20}, time.Now())
			}
			require.NoError(t, <-d2)
		})
	}
}
