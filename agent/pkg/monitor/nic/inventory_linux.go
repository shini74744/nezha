//go:build linux

package nic

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"

	"golang.org/x/sys/unix"
)

type linuxLink struct {
	Kind           string
	ParentIndex    int
	ExternalParent bool
}

func decorateInterfaces(rows []Interface) {
	decorateLinuxInterfacesWithLinks(rows, "/sys/class/net", "/proc/net/vlan", readLinuxLinks())
}

// sysfs fallback is also used by fixture tests. Never interpret an arbitrary
// iflink as a parent: veth uses it for a peer, possibly in another namespace.
func decorateLinuxInterfaces(rows []Interface, sysRoot, vlanRoot string) {
	decorateLinuxInterfacesWithLinks(rows, sysRoot, vlanRoot, nil)
}

func decorateLinuxInterfacesWithLinks(rows []Interface, sysRoot, vlanRoot string, links map[string]linuxLink) {
	read := func(p string) string { b, _ := os.ReadFile(p); return strings.TrimSpace(string(b)) }
	exists := func(p string) bool { _, e := os.Stat(p); return e == nil }
	valid := func(name string) bool {
		return name != "" && name != "." && name != ".." && filepath.Base(name) == name
	}
	indexNames := make(map[int]string, len(rows))
	for _, row := range rows {
		if !valid(row.Name) {
			continue
		}
		if index, err := strconv.Atoi(read(filepath.Join(sysRoot, row.Name, "ifindex"))); err == nil && index > 0 {
			indexNames[index] = row.Name
		}
	}
	for i := range rows {
		row := &rows[i]
		if !valid(row.Name) {
			continue
		}
		root := filepath.Join(sysRoot, row.Name)
		linkType := read(filepath.Join(root, "type"))
		if linkType == "" {
			continue
		}
		link, hasLink := links[row.Name]
		switch {
		case linkType == "772":
			row.Kind = "loopback"
		case linkType == "512":
			row.Kind = "ppp"
		case exists(filepath.Join(root, "bridge")):
			row.Kind = "bridge"
		case exists(filepath.Join(root, "bonding")):
			row.Kind = "bond"
		case exists(filepath.Join(vlanRoot, row.Name)):
			row.Kind = "vlan"
		case exists(filepath.Join(root, "tun_flags")):
			row.Kind = "tunnel"
		case exists(filepath.Join(root, "device")):
			row.Kind = "physical"
			driver, _ := filepath.EvalSymlinks(filepath.Join(root, "device", "driver"))
			if exists(filepath.Join(root, "device", "physfn")) {
				row.Kind = "virtual"
			}
			switch filepath.Base(driver) {
			case "virtio_net", "hv_netvsc", "xen-netfront", "vif", "vmxnet3", "iavf", "i40evf", "ixgbevf", "igbvf":
				row.Kind = "virtual"
			}
		default:
			row.Kind = "virtual"
		}
		switch link.Kind {
		case "bridge", "bond", "vlan", "ppp", "veth", "macvlan", "macvtap", "ipvlan", "ipvtap", "wireguard", "dummy":
			row.Kind = link.Kind
		case "tun", "gre", "gretap", "ip6gre", "ip6gretap", "ipip", "sit", "ip6tnl", "vxlan", "geneve", "vti", "vti6":
			row.Kind = "tunnel"
		}
		switch read(filepath.Join(root, "operstate")) {
		case "up":
			row.State = "up"
		case "down", "lowerlayerdown", "notpresent":
			row.State = "down"
		}
		if speed, err := strconv.ParseUint(read(filepath.Join(root, "speed")), 10, 64); err == nil {
			row.SpeedMbps = speed
		}
		row.Parent = ""
		switch row.Kind {
		case "vlan", "macvlan", "macvtap", "ipvlan", "ipvtap":
			if hasLink {
				if !link.ExternalParent {
					row.Parent = indexNames[link.ParentIndex]
				}
			} else {
				// Only accept an actual lower-device symlink resolving to a device visible
				// in this namespace. iflink alone is not sufficient evidence.
				lower, _ := filepath.Glob(filepath.Join(root, "lower_*"))
				if len(lower) == 1 {
					name := strings.TrimPrefix(filepath.Base(lower[0]), "lower_")
					actual, e1 := filepath.EvalSymlinks(lower[0])
					local, e2 := filepath.EvalSymlinks(filepath.Join(sysRoot, name))
					if valid(name) && e1 == nil && e2 == nil && actual == local {
						row.Parent = name
					}
				}
			}
		}
		if row.Parent == row.Name {
			row.Parent = ""
		}
		if master, err := filepath.EvalSymlinks(filepath.Join(root, "master")); err == nil {
			row.Master = filepath.Base(master)
		}
	}
}

func readLinuxLinks() map[string]linuxLink {
	data, err := syscall.NetlinkRIB(syscall.RTM_GETLINK, syscall.AF_UNSPEC)
	if err != nil {
		return nil
	}
	messages, err := syscall.ParseNetlinkMessage(data)
	if err != nil {
		return nil
	}
	result := make(map[string]linuxLink)
	for _, message := range messages {
		if message.Header.Type != syscall.RTM_NEWLINK {
			continue
		}
		attrs, err := syscall.ParseNetlinkRouteAttr(&message)
		if err != nil {
			continue
		}
		name, link := decodeLinuxLink(attrs)
		if name != "" {
			result[name] = link
		}
	}
	return result
}

func decodeLinuxLink(attrs []syscall.NetlinkRouteAttr) (string, linuxLink) {
	var name string
	var link linuxLink
	for _, attr := range attrs {
		switch attr.Attr.Type & 0x3fff {
		case unix.IFLA_IFNAME:
			name = strings.TrimRight(string(attr.Value), "\x00")
		case unix.IFLA_LINK:
			if len(attr.Value) >= 4 {
				link.ParentIndex = int(binary.NativeEndian.Uint32(attr.Value))
			}
		case unix.IFLA_LINK_NETNSID:
			link.ExternalParent = true
		case unix.IFLA_LINKINFO:
			for data := attr.Value; len(data) >= 4; {
				length := int(binary.NativeEndian.Uint16(data[:2]))
				typ := binary.NativeEndian.Uint16(data[2:4]) & 0x3fff
				if length < 4 || length > len(data) {
					break
				}
				if typ == unix.IFLA_INFO_KIND {
					link.Kind = strings.TrimRight(string(data[4:length]), "\x00")
				}
				aligned := (length + 3) &^ 3
				if aligned > len(data) {
					break
				}
				data = data[aligned:]
			}
		}
	}
	return name, link
}
