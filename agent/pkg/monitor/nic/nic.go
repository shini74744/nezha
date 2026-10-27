package nic

import (
	"context"
	"github.com/cloudflare/ahocorasick"
	"github.com/shirou/gopsutil/v4/net"
)

type NICKeyType string

const NICKey NICKeyType = "nic"

var (
	excludeNetInterfaces = []string{"lo", "tun", "docker", "veth", "br-", "vmbr", "vnet", "kube", "Meta", "tailscale", "fw", "tap"}
	defaultMatcher       = ahocorasick.NewStringMatcher(excludeNetInterfaces)
)

type Counter struct {
	Index   int
	In, Out uint64
}
type Sample struct {
	In, Out    uint64
	Interfaces map[string]Counter
}

// ContinuousFrom rejects membership changes, recreated devices and individual
// counter resets, even when another interface hides the reset in the total.
func (s Sample) ContinuousFrom(previous Sample) bool {
	if len(s.Interfaces) != len(previous.Interfaces) || s.In < previous.In || s.Out < previous.Out {
		return false
	}
	for name, current := range s.Interfaces {
		old, ok := previous.Interfaces[name]
		if !ok || current.Index != old.Index || current.In < old.In || current.Out < old.Out {
			return false
		}
	}
	return true
}
func GetState(ctx context.Context) (Sample, error) {
	counters, err := net.IOCountersWithContext(ctx, true)
	if err != nil {
		return Sample{}, err
	}
	metadata, err := net.InterfacesWithContext(ctx)
	if err != nil {
		return Sample{}, err
	} // Do not invent identities from partial enumeration.
	allow, _ := ctx.Value(NICKey).(map[string]bool)
	return sampleCounters(counters, metadata, allow), nil
}

func sampleCounters(counters []net.IOCountersStat, metadata []net.InterfaceStat, allow map[string]bool) Sample {
	indices := make(map[string]int, len(metadata))
	for _, row := range metadata {
		indices[row.Name] = row.Index
	}
	result := Sample{Interfaces: make(map[string]Counter)}
	for _, row := range counters {
		if !IsMonitored(row.Name, allow) {
			continue
		}
		index, ok := indices[row.Name]
		if !ok {
			continue
		} // Removed between the two reads; next sample handles membership.
		result.Interfaces[row.Name] = Counter{Index: index, In: row.BytesRecv, Out: row.BytesSent}
		result.In += row.BytesRecv
		result.Out += row.BytesSent
	}
	return result
}

// Preserve the original default filtering and explicit allowlist semantics.
func IsMonitored(name string, allow map[string]bool) bool {
	if defaultMatcher.Contains([]byte(name)) && !allow[name] {
		return false
	}
	return len(allow) == 0 || allow[name]
}
