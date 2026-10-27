//go:build linux

package nic

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

func decorateInterfaces(rows []Interface) {
	decorateLinuxInterfaces(rows, "/sys/class/net", "/proc/net/vlan")
}

func decorateLinuxInterfaces(rows []Interface, sysRoot, vlanRoot string) {
	read := func(path string) string {
		data, _ := os.ReadFile(path)
		return strings.TrimSpace(string(data))
	}
	exists := func(path string) bool {
		_, err := os.Stat(path)
		return err == nil
	}
	indexNames := make(map[string]string, len(rows))
	for _, row := range rows {
		if row.Name == "." || filepath.Base(row.Name) != row.Name {
			continue
		}
		if index := read(filepath.Join(sysRoot, row.Name, "ifindex")); index != "" {
			indexNames[index] = row.Name
		}
	}
	for i := range rows {
		row := &rows[i]
		if row.Name == "." || filepath.Base(row.Name) != row.Name {
			continue
		}
		root := filepath.Join(sysRoot, row.Name)
		linkType := read(filepath.Join(root, "type"))
		if linkType == "" {
			continue
		}
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
			switch filepath.Base(driver) {
			case "virtio_net", "hv_netvsc", "xen-netfront", "vmxnet3":
				row.Kind = "virtual"
			}
		default:
			row.Kind = "virtual"
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
		parent := indexNames[read(filepath.Join(root, "iflink"))]
		if parent != row.Name {
			row.Parent = parent
		}
		if master, err := filepath.EvalSymlinks(filepath.Join(root, "master")); err == nil {
			row.Master = filepath.Base(master)
		}
	}
}
