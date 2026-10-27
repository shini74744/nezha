package nic

import (
	"reflect"
	"testing"

	"github.com/shirou/gopsutil/v4/net"
)

func TestInventoryPreservesDefaultAndExplicitSampling(t *testing.T) {
	names := []string{"enp2s0f0", "enp2s0f1", "br1204", "br1205", "ppp0", "lo", "br-test", "veth0", "docker0", "tun0"}
	counters := make([]net.IOCountersStat, len(names))
	for i, name := range names {
		counters[i].Name = name
	}
	defaults := buildInventory(counters, nil, nil)
	if !defaults.Available || len(defaults.Interfaces) != len(names) {
		t.Fatal(defaults)
	}
	for _, row := range defaults.Interfaces {
		want := row.Name == "enp2s0f0" || row.Name == "enp2s0f1" || row.Name == "br1204" || row.Name == "br1205" || row.Name == "ppp0"
		if row.DefaultMonitored != want || row.Monitored != want {
			t.Errorf("default changed for %s: %+v", row.Name, row)
		}
	}
	allow := map[string]bool{"enp2s0f0": true, "enp2s0f1": true, "br1204": false, "lo": false, "missing0": true}
	before := map[string]bool{"enp2s0f0": true, "enp2s0f1": true, "br1204": false, "lo": false, "missing0": true}
	explicit := buildInventory(counters, nil, allow)
	for _, row := range explicit.Interfaces {
		want := row.Name == "enp2s0f0" || row.Name == "enp2s0f1"
		if row.Monitored != want {
			t.Errorf("explicit selection %s = %t", row.Name, row.Monitored)
		}
	}
	if !reflect.DeepEqual(allow, before) {
		t.Fatal("discovery modified the allowlist")
	}
	if !IsMonitored("lo", map[string]bool{"lo": true}) {
		t.Fatal("explicit override lost")
	}
	if IsMonitored("enp2s0f0", map[string]bool{"enp2s0f0": false}) {
		t.Fatal("all-false must not restore defaults")
	}
	if !IsMonitored("enp2s0f0", map[string]bool{}) {
		t.Fatal("empty map must retain old defaults")
	}
}

func TestInventoryOptionalMetadataAndDuplicateNames(t *testing.T) {
	got := buildInventory([]net.IOCountersStat{{Name: "Ethernet 2"}, {Name: "ppp0"}, {Name: "lo"}, {Name: "ppp0"}},
		[]net.InterfaceStat{{Name: "Ethernet 2", Flags: []string{"up"}}, {Name: "lo", Flags: []string{"up", "loopback"}}}, nil)
	if len(got.Interfaces) != 3 {
		t.Fatal(got)
	}
	for _, row := range got.Interfaces {
		switch row.Name {
		case "Ethernet 2":
			if row.State != "up" {
				t.Fatal(row)
			}
		case "ppp0":
			if row.State != "unknown" {
				t.Fatal(row)
			}
		case "lo":
			if row.Kind != "loopback" {
				t.Fatal(row)
			}
		}
	}
}
