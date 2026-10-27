//go:build linux

package nic

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

func auditFixture(t *testing.T) (string, string, func(string, string), func(string)) {
	t.Helper()
	base := t.TempDir()
	sys := filepath.Join(base, "sys")
	vlan := filepath.Join(base, "vlan")
	mkdir := func(p string) {
		t.Helper()
		if e := os.MkdirAll(p, 0755); e != nil {
			t.Fatal(e)
		}
	}
	write := func(p, v string) {
		t.Helper()
		mkdir(filepath.Dir(p))
		if e := os.WriteFile(p, []byte(v), 0600); e != nil {
			t.Fatal(e)
		}
	}
	return sys, vlan, write, mkdir
}
func TestAuditVirtualDevicesAreNotPhysicalPorts(t *testing.T) {
	for _, driver := range []string{"iavf", "ixgbevf", "vif"} {
		t.Run(driver, func(t *testing.T) {
			sys, vlan, write, mkdir := auditFixture(t)
			root := filepath.Join(sys, "renamed0")
			write(filepath.Join(root, "type"), "1")
			mkdir(filepath.Join(root, "device"))
			target := filepath.Join(filepath.Dir(sys), "drivers", driver)
			mkdir(target)
			if e := os.Symlink(target, filepath.Join(root, "device", "driver")); e != nil {
				t.Fatal(e)
			}
			if driver != "vif" {
				pf := filepath.Join(filepath.Dir(sys), "pci", "physical-function")
				mkdir(pf)
				if e := os.Symlink(pf, filepath.Join(root, "device", "physfn")); e != nil {
					t.Fatal(e)
				}
			}
			rows := []Interface{{Name: "renamed0", Kind: "unknown"}}
			decorateLinuxInterfaces(rows, sys, vlan)
			t.Logf("driver=%s identified as %s", driver, rows[0].Kind)
			if rows[0].Kind == "physical" {
				t.Error("virtual function or Xen frontend mislabeled as physical port")
			}
		})
	}
}
func TestAuditPeerIndexIsNotLocalParent(t *testing.T) {
	sys, vlan, write, mkdir := auditFixture(t)
	for _, x := range []struct{ name, index, link string }{{"uplink", "2", "2"}, {"container-side", "7", "2"}} {
		root := filepath.Join(sys, x.name)
		write(filepath.Join(root, "type"), "1")
		write(filepath.Join(root, "ifindex"), x.index)
		write(filepath.Join(root, "iflink"), x.link)
	}
	mkdir(filepath.Join(sys, "uplink", "device"))
	// A veth peer in another namespace has index 2, unrelated to local uplink index 2.
	rows := []Interface{{Name: "uplink"}, {Name: "container-side"}}
	decorateLinuxInterfaces(rows, sys, vlan)
	t.Logf("veth peer index collides with local NIC: parent=%q", rows[1].Parent)
	if rows[1].Parent != "" {
		t.Error("cross-namespace peer index incorrectly resolved as local parent")
	}
}
func TestAuditExtendedClassificationAndUnavailableMetadata(t *testing.T) {
	sys, vlan, write, mkdir := auditFixture(t)
	cases := []struct{ name, kind, marker, typ string }{
		{"business-port", "physical", "device", "1"}, {"aggregate", "bond", "bonding", "1"},
		{"overlay", "tunnel", "tun_flags", "1"}, {"local-only", "loopback", "", "772"},
		{"renamed-dialer", "ppp", "", "512"}, {"lan-tagged", "vlan", "", "1"},
		{"arbitrary-bridge", "bridge", "bridge", "1"}, {"virtual-peer", "virtual", "", "1"},
	}
	rows := make([]Interface, 0, len(cases)+1)
	for i, x := range cases {
		root := filepath.Join(sys, x.name)
		write(filepath.Join(root, "type"), x.typ)
		write(filepath.Join(root, "ifindex"), strconv.Itoa(i+1))
		write(filepath.Join(root, "iflink"), strconv.Itoa(i+1))
		if x.marker != "" {
			mkdir(filepath.Join(root, x.marker))
		}
		if x.kind == "vlan" {
			write(filepath.Join(vlan, x.name), "VLAN")
		}
		write(filepath.Join(root, "operstate"), "lowerlayerdown")
		write(filepath.Join(root, "speed"), "-1")
		rows = append(rows, Interface{Name: x.name, Kind: "unknown"})
	}
	rows = append(rows, Interface{Name: "metadata-unavailable", Kind: "unknown", State: "unknown"})
	decorateLinuxInterfaces(rows, sys, vlan)
	for i, x := range cases {
		if rows[i].Kind != x.kind || rows[i].State != "down" || rows[i].SpeedMbps != 0 {
			t.Errorf("%s: got %+v want kind %s/down/no speed", x.name, rows[i], x.kind)
		}
	}
	if rows[len(cases)].Kind != "unknown" {
		t.Error("missing metadata must stay unknown")
	}
}
