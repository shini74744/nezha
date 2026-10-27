package model

import (
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func TestNetworkCounterEpochPreservesUnflushedTransfers(t *testing.T) {
	s := &Server{}
	InitServer(s)
	lease := s.AttachStateStream(runtimeOwnershipStream{})
	report := func(at int64, in, out uint64, epoch string) {
		require.True(t, lease.UpdateState(&HostState{NetInTransfer: in, NetOutTransfer: out, NetworkCounterEpoch: epoch}, time.Unix(at, 0)))
	}
	report(1, 1000, 0, "a")
	report(2, 1010, 0, "a")
	report(3, 500000, 0, "b")
	report(4, 500020, 0, "b")
	report(5, 0, 0, "c")
	report(6, 5, 0, "c")
	_, _, in, out := s.TransferDeltaAndAdvance()
	require.EqualValues(t, 35, in)
	require.Zero(t, out)
	_, _, in, out = s.TransferDeltaAndAdvance()
	require.Zero(t, in)
	require.Zero(t, out)
	// Reconnecting the same epoch must preserve observed bytes awaiting collection.
	report(7, 8, 0, "c")
	require.True(t, s.ClearStateStreamIfCurrent(lease))
	lease = s.AttachStateStream(runtimeOwnershipStream{})
	report(8, 10, 0, "c")
	_, _, in, _ = s.TransferDeltaAndAdvance()
	require.EqualValues(t, 5, in)
}
func TestNetworkCounterEpochWireRoundTrip(t *testing.T) {
	state := &HostState{NetworkCounterEpoch: "test-epoch", NetInTransfer: 123}
	require.Equal(t, "test-epoch", state.PB().GetNetworkCounterEpoch())
	require.Equal(t, "test-epoch", PB2State(state.PB()).NetworkCounterEpoch)
}
