//go:build linux

package nic

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLinuxInventoryReadsTypesAndRelationshipsWithoutNameHeuristics(t *testing.T) {
	root := t.TempDir()
	sys := filepath.Join(root, "sys")
	vlans := filepath.Join(root, "vlan")
	mkdir := func(p string) {
		t.Helper()
		if err := os.MkdirAll(p, 0755); err != nil {
			t.Fatal(err)
		}
	}
	write := func(p, v string) {
		t.Helper()
		mkdir(filepath.Dir(p))
		if err := os.WriteFile(p, []byte(v), 0600); err != nil {
			t.Fatal(err)
		}
	}
	for name, index := range map[string]string{"uplink": "2", "bridgeNamedAnything": "4", "dialer": "6", "tagged": "8", "virtNIC": "10", "lo": "1"} {
		write(filepath.Join(sys, name, "type"), "1")
		write(filepath.Join(sys, name, "ifindex"), index)
		write(filepath.Join(sys, name, "iflink"), index)
	}
	mkdir(filepath.Join(sys, "uplink", "device"))
	write(filepath.Join(sys, "uplink", "operstate"), "up")
	write(filepath.Join(sys, "uplink", "speed"), "1000")
	mkdir(filepath.Join(sys, "bridgeNamedAnything", "bridge"))
	if err := os.Symlink(filepath.Join(sys, "bridgeNamedAnything"), filepath.Join(sys, "uplink", "master")); err != nil {
		t.Fatal(err)
	}
	write(filepath.Join(sys, "dialer", "type"), "512")
	write(filepath.Join(sys, "dialer", "speed"), "-1")
	write(filepath.Join(sys, "lo", "type"), "772")
	write(filepath.Join(sys, "tagged", "iflink"), "2")
	write(filepath.Join(vlans, "tagged"), "VLAN")
	if err := os.Symlink(filepath.Join(sys, "uplink"), filepath.Join(sys, "tagged", "lower_uplink")); err != nil {
		t.Fatal(err)
	}
	mkdir(filepath.Join(sys, "virtNIC", "device"))
	mkdir(filepath.Join(root, "drivers", "virtio_net"))
	if err := os.Symlink(filepath.Join(root, "drivers", "virtio_net"), filepath.Join(sys, "virtNIC", "device", "driver")); err != nil {
		t.Fatal(err)
	}
	rows := []Interface{{Name: "uplink"}, {Name: "bridgeNamedAnything"}, {Name: "dialer"}, {Name: "tagged"}, {Name: "virtNIC"}, {Name: "lo"}, {Name: "unavailable", Kind: "unknown"}}
	decorateLinuxInterfaces(rows, sys, vlans)
	if rows[0].Kind != "physical" || rows[0].SpeedMbps != 1000 || rows[0].Master != "bridgeNamedAnything" || rows[0].State != "up" {
		t.Fatal(rows[0])
	}
	if rows[1].Kind != "bridge" || rows[2].Kind != "ppp" || rows[2].SpeedMbps != 0 || rows[3].Kind != "vlan" || rows[3].Parent != "uplink" {
		t.Fatal(rows)
	}
	if rows[4].Kind != "virtual" || rows[5].Kind != "loopback" || rows[6].Kind != "unknown" {
		t.Fatal(rows)
	}
}
