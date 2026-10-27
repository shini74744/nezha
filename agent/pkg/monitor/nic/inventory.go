package nic

import (
	"context"
	"sort"

	"github.com/shirou/gopsutil/v4/net"
)

// Inventory is read-only metadata returned with an authenticated config query.
// It is not part of AgentConfig and never changes the sampling policy.
type Inventory struct {
	Available  bool        `json:"available"`
	Interfaces []Interface `json:"interfaces"`
}

type Interface struct {
	Name             string `json:"name"`
	Kind             string `json:"kind"`
	State            string `json:"state"`
	SpeedMbps        uint64 `json:"speed_mbps,omitempty"`
	Parent           string `json:"parent,omitempty"`
	Master           string `json:"master,omitempty"`
	DefaultMonitored bool   `json:"default_monitored"`
	Monitored        bool   `json:"monitored"`
}

func Discover(ctx context.Context, allowList map[string]bool) Inventory {
	counters, err := net.IOCountersWithContext(ctx, true)
	if err != nil {
		return Inventory{Interfaces: []Interface{}}
	}
	// Counter names are authoritative: these are the names GetState samples.
	// Missing optional link metadata must not hide an otherwise usable counter.
	metadata, _ := net.InterfacesWithContext(ctx)
	inventory := buildInventory(counters, metadata, allowList)
	decorateInterfaces(inventory.Interfaces)
	return inventory
}

func buildInventory(counters []net.IOCountersStat, metadata []net.InterfaceStat, allowList map[string]bool) Inventory {
	byName := make(map[string]net.InterfaceStat, len(metadata))
	for _, info := range metadata {
		byName[info.Name] = info
	}
	result := Inventory{Available: true, Interfaces: make([]Interface, 0, len(counters))}
	seen := make(map[string]bool, len(counters))
	for _, counter := range counters {
		name := counter.Name
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		row := Interface{Name: name, Kind: "unknown", State: "unknown",
			DefaultMonitored: IsMonitored(name, nil), Monitored: IsMonitored(name, allowList)}
		if info, exists := byName[name]; exists {
			row.State = "down"
			for _, flag := range info.Flags {
				if flag == "up" {
					row.State = "up"
				}
				if flag == "loopback" {
					row.Kind = "loopback"
				}
			}
		}
		result.Interfaces = append(result.Interfaces, row)
	}
	sort.Slice(result.Interfaces, func(i, j int) bool { return result.Interfaces[i].Name < result.Interfaces[j].Name })
	return result
}
