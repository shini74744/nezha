package rpc

import (
	"github.com/stretchr/testify/require"
	"sync"
	"testing"
	"time"
)

func TestTaskNotificationsStayBoundedAndDoNotBlockAgent(t *testing.T) {
	q := newTaskNotificationQueue(2)
	release := make(chan struct{})
	entered := make(chan struct{}, 4)
	var done sync.WaitGroup
	defer close(q.jobs)
	defer func() { close(release); done.Wait() }()
	for i := 0; i < 4; i++ {
		done.Add(1)
		require.True(t, q.submit(func() { defer done.Done(); entered <- struct{}{}; <-release }))
		select {
		case <-entered:
		case <-time.After(time.Second):
			t.Fatal("worker did not start")
		}
	}
	require.True(t, q.submit(func() {}))
	require.True(t, q.submit(func() {}))
	started := time.Now()
	require.False(t, q.submit(func() { t.Error("overflow job ran") }))
	require.Less(t, time.Since(started), time.Second)
}
