package disk

import (
	"context"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	psDisk "github.com/shirou/gopsutil/v4/disk"
)

// IOState is whole-machine disk throughput in bytes/second. Available is false
// during warm-up or when the OS cannot expose counters; zero is a valid rate.
type IOState struct {
	ReadSpeed  uint64
	WriteSpeed uint64
	Available  bool
}

type ioSampler struct {
	mu       sync.Mutex
	previous map[string]psDisk.IOCountersStat
	at       time.Time
}

var defaultIOSampler ioSampler

func (s *ioSampler) sample(ctx context.Context, probe func(context.Context) (map[string]psDisk.IOCountersStat, error), now func() time.Time) IOState {
	s.mu.Lock()
	defer s.mu.Unlock()
	counters, err := probe(ctx)
	at := now()
	if err != nil || len(counters) == 0 {
		s.previous, s.at = nil, time.Time{}
		return IOState{}
	}
	elapsed := at.Sub(s.at).Seconds()
	var read, write float64
	available := false
	if !s.at.IsZero() && elapsed > 0 {
		for name, current := range counters {
			old, ok := s.previous[name]
			// Replaced/reset disks must not wrap unsigned deltas into huge rates.
			if !ok || current.ReadBytes < old.ReadBytes || current.WriteBytes < old.WriteBytes {
				continue
			}
			read += float64(current.ReadBytes-old.ReadBytes) / elapsed
			write += float64(current.WriteBytes-old.WriteBytes) / elapsed
			available = true
		}
	}
	s.previous, s.at = counters, at
	return IOState{ReadSpeed: boundedRate(read), WriteSpeed: boundedRate(write), Available: available}
}

func boundedRate(value float64) uint64 {
	if math.IsNaN(value) || value <= 0 {
		return 0
	}
	if value >= float64(^uint64(0)) {
		return ^uint64(0)
	}
	return uint64(value)
}

// Linux reports both devices and their partitions/stacked mappings. Count only
// whole leaf devices to avoid counting one write at several storage layers.
func selectIOCounters(counters map[string]psDisk.IOCountersStat, platform, sysRoot string) map[string]psDisk.IOCountersStat {
	if platform != "linux" {
		return counters
	}
	result := make(map[string]psDisk.IOCountersStat)
	for name, counter := range counters {
		if filepath.Base(name) != name || strings.HasPrefix(name, "loop") || strings.HasPrefix(name, "ram") || strings.HasPrefix(name, "zram") || strings.HasPrefix(name, "fd") || strings.HasPrefix(name, "sr") {
			continue
		}
		device := filepath.Join(sysRoot, "class", "block", name)
		if _, err := os.Stat(device); err != nil {
			continue
		}
		if _, err := os.Stat(filepath.Join(device, "partition")); !os.IsNotExist(err) {
			continue
		}
		slaves, err := os.ReadDir(filepath.Join(device, "slaves"))
		if err != nil || len(slaves) > 0 {
			continue
		}
		result[name] = counter
	}
	return result
}

func GetIOState(ctx context.Context) IOState {
	return defaultIOSampler.sample(ctx, func(ctx context.Context) (map[string]psDisk.IOCountersStat, error) {
		counters, err := psDisk.IOCountersWithContext(ctx)
		if err != nil {
			return nil, err
		}
		sysRoot := os.Getenv("HOST_SYS")
		if sysRoot == "" {
			sysRoot = "/sys"
		}
		return selectIOCounters(counters, runtime.GOOS, sysRoot), nil
	}, time.Now)
}
