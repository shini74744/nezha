package nic

import (
	psnet "github.com/shirou/gopsutil/v4/net"
	"testing"
)

func TestSelectedInterfacesCountOnlyTheirOwnTraffic(t *testing.T) {
	counters := []psnet.IOCountersStat{
		{Name: "eth0", BytesRecv: 101, BytesSent: 17},
		{Name: "eth1", BytesRecv: 202, BytesSent: 29},
		{Name: "ppp0", BytesRecv: 303, BytesSent: 41},
		{Name: "br-0", BytesRecv: 404, BytesSent: 53},
		{Name: "lo", BytesRecv: 505, BytesSent: 67},
		{Name: "vanished0", BytesRecv: 9999, BytesSent: 9999},
	}
	metadata := []psnet.InterfaceStat{{Name: "eth0", Index: 1}, {Name: "eth1", Index: 2}, {Name: "ppp0", Index: 3}, {Name: "br-0", Index: 4}, {Name: "lo", Index: 5}}
	cases := []struct {
		name    string
		allow   map[string]bool
		in, out uint64
		count   int
	}{
		{"only first port", map[string]bool{"eth0": true, "eth1": false, "ppp0": false}, 101, 17, 1},
		{"only second port", map[string]bool{"eth1": true}, 202, 29, 1},
		{"two ports", map[string]bool{"eth0": true, "eth1": true}, 303, 46, 2},
		{"dial up only", map[string]bool{"ppp0": true}, 303, 41, 1},
		{"explicit excluded bridge", map[string]bool{"br-0": true}, 404, 53, 1},
		{"none selected", map[string]bool{"eth0": false}, 0, 0, 0},
		{"existing default rules", nil, 606, 87, 3},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			got := sampleCounters(counters, metadata, tt.allow)
			if got.In != tt.in || got.Out != tt.out || len(got.Interfaces) != tt.count {
				t.Fatalf("wrong traffic: %+v", got)
			}
		})
	}
}
