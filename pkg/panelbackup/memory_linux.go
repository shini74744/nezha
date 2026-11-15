//go:build linux

package panelbackup

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

func memoryAvailable(read func(string) ([]byte, error)) (uint64, bool) {
	var available uint64
	known := false
	if data, err := read("/proc/meminfo"); err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			fields := strings.Fields(line)
			if len(fields) == 3 && fields[0] == "MemAvailable:" && fields[2] == "kB" {
				if n, e := strconv.ParseUint(fields[1], 10, 64); e == nil && n < ^uint64(0)/1024 {
					available = n * 1024
					known = true
				}
			}
		}
	}
	// Account for a tighter cgroup v2 limit, including systemd unit ancestry.
	// An unresolved proc/cgroup file never invents a zero-memory reading.
	roots := []string{"/sys/fs/cgroup"}
	if data, err := read("/proc/self/cgroup"); err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			if strings.HasPrefix(line, "0::/") {
				rel := filepath.Clean(strings.TrimPrefix(line, "0::"))
				for rel != "/" && rel != "." {
					roots = append(roots, filepath.Join("/sys/fs/cgroup", strings.TrimPrefix(rel, "/")))
					rel = filepath.Dir(rel)
				}
			}
		}
	}
	for _, root := range roots {
		max, e1 := read(filepath.Join(root, "memory.max"))
		current, e2 := read(filepath.Join(root, "memory.current"))
		if e1 != nil || e2 != nil {
			continue
		}
		limit, e1 := strconv.ParseUint(strings.TrimSpace(string(max)), 10, 64)
		used, e2 := strconv.ParseUint(strings.TrimSpace(string(current)), 10, 64)
		if e1 != nil || e2 != nil {
			continue
		}
		remaining := uint64(0)
		if used < limit {
			remaining = limit - used
		}
		if !known || remaining < available {
			available = remaining
			known = true
		}
	}
	return available, known
}

func checkBackupMemory(required uint64) error {
	available, known := memoryAvailable(os.ReadFile)
	if known && available < required {
		return fmt.Errorf("可用内存不足，已停止备份（当前约 %d MiB，需要至少 %d MiB），请稍后重试", available>>20, required>>20)
	}
	return nil
}
