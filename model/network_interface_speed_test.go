package model

import (
	pb "github.com/nezhahq/nezha/proto"
	"github.com/stretchr/testify/require"
	"strings"
	"testing"
)

func TestNetworkInterfaceMetricsIdentityAndAvailability(t *testing.T) {
	for _, name := range []string{"eth0", "eth0.123", "Ethernet 2", "本地连接", "en/0"} {
		for _, d := range []string{"in", "out"} {
			require.True(t, IsNetworkInterfaceMetric(NetworkInterfaceMetric(name, d)))
		}
	}
	for _, name := range []string{"nic__in_speed", "nic_00_in_speed", "nic_zz_in_speed", "nic_65746830_out_speed.*", "nic_" + strings.Repeat("61", 257) + "_in_speed"} {
		require.False(t, IsNetworkInterfaceMetric(name))
	}
	state := PB2State(&pb.State{NetInSpeed: 90, NetworkInterfaces: []*pb.State_NetworkInterface{
		{Name: "eth0", InSpeed: 10, OutSpeed: 20, Available: true}, {Name: "eth1", Available: true},
		{Name: "warmup", InSpeed: 100, Available: false}, {Name: "eth0", InSpeed: 999, Available: true}, nil,
	}})
	require.Len(t, state.NetworkInterfaces, 3)
	values := RecordedServerState{State: &state}.Metrics()
	require.Equal(t, float64(90), values["net_in_speed"])
	require.Equal(t, float64(10), values[NetworkInterfaceMetric("eth0", "in")])
	v, ok := values[NetworkInterfaceMetric("eth1", "in")]
	require.True(t, ok)
	require.Zero(t, v)
	_, ok = values[NetworkInterfaceMetric("warmup", "in")]
	require.False(t, ok)
	require.Equal(t, state.NetworkInterfaces, PB2State(state.PB()).NetworkInterfaces)
	clone := cloneHostState(&state)
	clone.NetworkInterfaces[0].Name = "changed"
	require.Equal(t, "eth0", state.NetworkInterfaces[0].Name)
}
