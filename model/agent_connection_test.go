package model

import (
	"context"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

type connectedStateStream struct{ runtimeOwnershipStream }

func (connectedStateStream) Context() context.Context { return context.Background() }
func TestLiveReportAcceptsEarlierBootWithoutPurge(t *testing.T) {
	s := &Server{Common: Common{ID: 4}, UUID: "machine"}
	InitServer(s)
	now := time.Now()
	persisted := 0
	save := func(Transfer) error { persisted++; return nil }
	_, err := s.RuntimeHandle().RefreshHostReport(&Host{Platform: "debian", BootTime: 100}, now, save)
	require.NoError(t, err)
	old := s.AttachStateStream(connectedStateStream{})
	require.True(t, old.UpdateState(&HostState{NetInTransfer: 100, NetOutTransfer: 200}, now))
	got, err := s.RuntimeHandle().RefreshHostReport(&Host{Platform: "ubuntu", BootTime: 50}, now, save)
	require.NoError(t, err)
	require.True(t, got.Applied)
	require.True(t, got.Restart)
	require.Equal(t, "ubuntu", s.RuntimeSnapshot().Host.Platform)
	require.False(t, old.UpdateState(&HostState{NetInTransfer: 900}, now))
	current := s.AttachStateStream(connectedStateStream{})
	require.True(t, current.UpdateState(&HostState{NetInTransfer: 999999, NetOutTransfer: 888888}, now))
	require.EqualValues(t, 999999, s.RuntimeSnapshot().PrevTransferInSnapshot)
	before := persisted
	got, err = s.RuntimeHandle().RefreshHostReport(&Host{Platform: "ubuntu", BootTime: 50, CPU: []string{"new CPU"}}, now, save)
	require.NoError(t, err)
	require.True(t, got.Equal)
	require.Equal(t, before, persisted)
	require.True(t, current.UpdateState(&HostState{}, now), "periodic host report must not detach the state stream")
}
func TestRetiredMachineCannotPublishOrReattach(t *testing.T) {
	s := &Server{Common: Common{ID: 4}, UUID: "machine"}
	InitServer(s)
	old := s.AttachStateStream(connectedStateStream{})
	require.True(t, old.UpdateState(&HostState{}, time.Now()))
	s.RetireMachineRuntime()
	called := false
	require.False(t, old.UpdateStateWithSideEffect(&HostState{}, time.Now(), func() error { called = true; return nil }))
	require.False(t, called)
	require.False(t, s.AttachStateStream(connectedStateStream{}).UpdateState(&HostState{}, time.Now()))
	require.False(t, s.MachineRuntimeActive())
	require.True(t, s.RuntimeSnapshot().LastActive.IsZero())
}
