package terminalsession

import (
	"bytes"
	"github.com/stretchr/testify/require"
	"io"
	"testing"
	"time"
)

func TestBridgeDetachDoesNotEndTaskAndReplaysOutput(t *testing.T) {
	b := New()
	defer b.Close()
	a, e := b.Attach()
	require.NoError(t, e)
	_, e = b.Attach()
	require.ErrorIs(t, e, ErrAttached)
	require.NoError(t, b.Send(a, []byte("command")))
	got := make([]byte, 20)
	n, e := b.Read(got)
	require.NoError(t, e)
	require.Equal(t, "command", string(got[:n]))
	b.Detach(a)
	_, e = b.Write([]byte("completed while browser closed"))
	require.NoError(t, e)
	next, e := b.Attach()
	require.NoError(t, e)
	require.Equal(t, "completed while browser closed", string(<-next.Output))
	require.Error(t, b.Send(a, []byte("stale input")))
	require.NoError(t, b.Send(next, []byte("next")))
	n, e = b.Read(got)
	require.NoError(t, e)
	require.Equal(t, "next", string(got[:n]))
}
func TestBridgeSlowClientAndHistoryAreBounded(t *testing.T) {
	b := New()
	defer b.Close()
	a, e := b.Attach()
	require.NoError(t, e)
	data := bytes.Repeat([]byte("x"), HistoryLimit*8)
	n, e := b.Write(data)
	require.NoError(t, e)
	require.Equal(t, len(data), n)
	select {
	case <-a.Done:
	case <-time.After(time.Second):
		t.Fatal("slow viewer not detached")
	}
	require.LessOrEqual(t, len(a.Output), 64)
	next, e := b.Attach()
	require.NoError(t, e)
	require.Len(t, <-next.Output, HistoryLimit)
}
func TestBridgeCloseUnblocksReadAndWrite(t *testing.T) {
	b := New()
	done := make(chan error, 1)
	go func() { _, e := b.Read(make([]byte, 10)); done <- e }()
	require.NoError(t, b.Close())
	require.NoError(t, b.Close())
	select {
	case e := <-done:
		require.ErrorIs(t, e, io.EOF)
	case <-time.After(time.Second):
		t.Fatal("blocked reader")
	}
	_, e := b.Write([]byte("x"))
	require.ErrorIs(t, e, io.ErrClosedPipe)
	_, e = b.Attach()
	require.ErrorIs(t, e, ErrClosed)
}
func TestBridgeConcurrentLifecycle(t *testing.T) {
	b := New()
	defer b.Close()
	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < 10000; i++ {
			_, _ = b.Write([]byte("output"))
		}
	}()
	for i := 0; i < 1000; i++ {
		a, e := b.Attach()
		if e == nil {
			b.Detach(a)
		}
	}
	<-done
}
