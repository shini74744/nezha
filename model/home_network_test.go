package model

import (
	pb "github.com/nezhahq/nezha/proto"
	"github.com/stretchr/testify/require"
	"math"
	"strings"
	"testing"
)

func TestHomeNetworkProjection(t *testing.T) {
	s := &Server{HomeNetworkInterfacesRaw: `["ens18","wg0"]`}
	state := &HostState{NetInSpeed: 99999, NetInTransfer: 888888, NetworkInterfaces: []NetworkInterfaceSpeed{
		{Name: "ens18", InSpeed: 10, OutSpeed: 20, InTransfer: 100, OutTransfer: 200, Available: true, CountersAvailable: true},
		{Name: "wg0", InSpeed: 30, OutSpeed: 40, InTransfer: 300, OutTransfer: 400, Available: true, CountersAvailable: true},
		{Name: "private", InSpeed: 999, InTransfer: 999, Available: true, CountersAvailable: true},
	}}
	v := s.HomeNetwork(state, true)
	require.Equal(t, uint64(40), v.InSpeed)
	require.Equal(t, uint64(60), v.OutSpeed)
	require.Equal(t, uint64(400), v.InTransfer)
	require.Equal(t, uint64(600), v.OutTransfer)
	require.Equal(t, []string{"ens18", "wg0"}, v.Interfaces)
	require.Empty(t, s.HomeNetwork(state, false).Interfaces)
	require.Equal(t, uint64(99999), state.NetInSpeed)
	state.NetworkInterfaces = state.NetworkInterfaces[:1]
	v = s.HomeNetwork(state, true)
	require.False(t, v.RatesAvailable)
	require.False(t, v.CountersAvailable)
	require.Zero(t, v.InSpeed)
	s.HomeNetworkInterfacesRaw = "[]"
	require.Nil(t, s.HomeNetwork(state, true))
	s.HomeNetworkInterfacesRaw = `["ens18"]`
	state.NetworkInterfaces[0].InSpeed = 0
	state.NetworkInterfaces[0].InTransfer = 0
	require.True(t, s.HomeNetwork(state, true).RatesAvailable)
	require.True(t, s.HomeNetwork(state, true).CountersAvailable)
	require.False(t, s.HomeNetwork(nil, true).CountersAvailable)
}
func TestHomeNetworkNamesAndWireValidation(t *testing.T) {
	names, err := NormalizeHomeNetworkNames([]string{"wg0", "ens18", "wg0"})
	require.NoError(t, err)
	require.Equal(t, []string{"ens18", "wg0"}, names)
	for _, bad := range [][]string{{""}, {"a\nb"}, {strings.Repeat("x", 257)}, make([]string, 257)} {
		_, err = NormalizeHomeNetworkNames(bad)
		require.Error(t, err)
	}
	rows := decodeNetworkInterfaces([]*pb.State_NetworkInterface{{Name: "ens18", CountersAvailable: true, CounterEpoch: "e", InTransfer: 100}, {Name: "bad", CountersAvailable: true, CounterEpoch: "e", InTransfer: math.MaxUint64}, {Name: "legacy", Available: true}})
	require.True(t, rows[0].CountersAvailable)
	require.False(t, rows[1].CountersAvailable)
	require.False(t, rows[2].CountersAvailable)
}
