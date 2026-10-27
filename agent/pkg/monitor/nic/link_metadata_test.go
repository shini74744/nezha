//go:build linux

package nic

import (
	"encoding/binary"
	"golang.org/x/sys/unix"
	"path/filepath"
	"syscall"
	"testing"
)

func TestLinuxLinkMetadataTypesAndNamespaceBoundaries(t *testing.T) {
	for _, kind := range []string{"vlan", "macvlan", "ipvlan", "veth", "wireguard", "dummy"} {
		for _, external := range []bool{false, true} {
			t.Run(kind+map[bool]string{false: "-local", true: "-external"}[external], func(t *testing.T) {
				sys, vlan, write, mkdir := auditFixture(t)
				for _, row := range []struct{ name, index string }{{"port", "2"}, {"child", "3"}} {
					write(filepath.Join(sys, row.name, "type"), "1")
					write(filepath.Join(sys, row.name, "ifindex"), row.index)
					write(filepath.Join(sys, row.name, "iflink"), "2")
				}
				mkdir(filepath.Join(sys, "port", "device"))
				rows := []Interface{{Name: "port"}, {Name: "child"}}
				decorateLinuxInterfacesWithLinks(rows, sys, vlan, map[string]linuxLink{"child": {Kind: kind, ParentIndex: 2, ExternalParent: external}})
				if rows[1].Kind != kind {
					t.Fatalf("type: %+v", rows[1])
				}
				want := ""
				if !external && (kind == "vlan" || kind == "macvlan" || kind == "ipvlan") {
					want = "port"
				}
				if rows[1].Parent != want {
					t.Fatalf("parent=%q want=%q", rows[1].Parent, want)
				}
			})
		}
	}
}
func TestDecodeLinuxLinkNestedAttributes(t *testing.T) {
	kind := []byte("veth\x00")
	n := 4 + len(kind)
	nested := make([]byte, (n+3)&^3)
	binary.NativeEndian.PutUint16(nested, uint16(n))
	binary.NativeEndian.PutUint16(nested[2:], unix.IFLA_INFO_KIND)
	copy(nested[4:], kind)
	index := make([]byte, 4)
	binary.NativeEndian.PutUint32(index, 2)
	attrs := []syscall.NetlinkRouteAttr{
		{Attr: syscall.RtAttr{Type: unix.IFLA_IFNAME}, Value: []byte("veth-custom\x00")},
		{Attr: syscall.RtAttr{Type: unix.IFLA_LINK}, Value: index},
		{Attr: syscall.RtAttr{Type: unix.IFLA_LINKINFO | 0x8000}, Value: nested},
		{Attr: syscall.RtAttr{Type: unix.IFLA_LINK_NETNSID}, Value: []byte{0, 0, 0, 0}},
	}
	name, got := decodeLinuxLink(attrs)
	if name != "veth-custom" || got.Kind != "veth" || got.ParentIndex != 2 || !got.ExternalParent {
		t.Fatal(name, got)
	}
	for _, bad := range [][]byte{{}, {1}, {1, 0, 1, 0}, {255, 255, 1, 0}, {4, 0, 1, 0}} {
		_, got := decodeLinuxLink([]syscall.NetlinkRouteAttr{{Attr: syscall.RtAttr{Type: unix.IFLA_LINKINFO}, Value: bad}})
		if got.Kind != "" {
			t.Fatal(got)
		}
	}
}
