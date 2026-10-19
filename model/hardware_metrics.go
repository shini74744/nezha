package model

import (
	"fmt"
	"math"
	"regexp"
	"strings"
)

var cpuSensorPattern = regexp.MustCompile("(?i)(^|[^a-z])(cpu|coretemp|k10temp|tctl|tdie|package id|core [0-9]|cpu_thermal|cpu-thermal)([^a-z]|$)|^tc0d$|^[pe]acc mtr temp sensor[0-9]+$")

func validHardware(v, max float64) bool {
	return v >= 0 && v <= max && !math.IsNaN(v) && !math.IsInf(v, 0)
}
func cpuSensorTemperature(temps []SensorTemperature) (float64, bool) {
	var highest float64
	for _, t := range temps {
		n := strings.ToLower(t.Name)
		if strings.Contains(n, "acpi") || strings.Contains(n, "thermalzone") || strings.Contains(n, "gpu") || strings.Contains(n, "nvme") || strings.Contains(n, "disk") || strings.Contains(n, "pmu") || strings.Contains(n, "pmgr") || strings.Contains(n, "heatsink") || strings.Contains(n, "proximity") {
			continue
		}
		if cpuSensorPattern.MatchString(n) && validHardware(t.Temperature, 150) && t.Temperature > highest {
			highest = t.Temperature
		}
	}
	return highest, highest > 0
}

// These metrics belong to the saved last-minute snapshots, not TSDB's old aggregate GPU series.
func appendHardwareMetrics(values map[string]float64, s *HostState) {
	if validHardware(s.CPUFrequencyMHz, 100000) && s.CPUFrequencyMHz > 0 && (s.CPUFrequencyKind == "current" || s.CPUFrequencyKind == "reported" || s.CPUFrequencyKind == "nominal") {
		values["cpu_frequency_mhz"] = s.CPUFrequencyMHz
	}
	if v, ok := cpuSensorTemperature(s.Temperatures); ok {
		values["cpu_temperature"] = v
	}
	for i, g := range s.GPUs {
		key := fmt.Sprintf("gpu_%d", i)
		if g.MemoryTotal > 0 && g.MemoryTotal <= 1<<30 && g.MemoryUsed <= g.MemoryTotal {
			values[key+"_memory_percent"] = float64(g.MemoryUsed) / float64(g.MemoryTotal) * 100
		}
		if g.SharedMemoryTotal > 0 && g.SharedMemoryTotal <= 1<<30 && g.SharedMemoryUsed <= g.SharedMemoryTotal {
			values[key+"_shared_percent"] = float64(g.SharedMemoryUsed) / float64(g.SharedMemoryTotal) * 100
		}
		if g.Name == "" {
			continue
		}
		var temp float64
		count := 0
		for _, t := range s.Temperatures {
			if t.Name == "GPU Core / "+g.Name && validHardware(t.Temperature, 150) && t.Temperature > 0 {
				temp = t.Temperature
				count++
			}
		}
		if count == 1 {
			values[key+"_temperature"] = temp
		}
	}
}

// AlignSnapshotGPU prevents a disappeared/reordered adapter from inheriting
// another GPU's final-minute curve. Legacy unnamed reports retain old behavior.
func AlignSnapshotGPU(values map[string]float64, sample, latest *HostState) map[string]float64 {
	if sample == nil || latest == nil || len(latest.GPUs) == 0 {
		return values
	}
	targets := map[string]int{}
	for i, g := range latest.GPUs {
		if g.Name == "" {
			return values
		}
		if _, ok := targets[g.Name]; ok {
			return values
		}
		targets[g.Name] = i
	}
	out := make(map[string]float64, len(values))
	for k, v := range values {
		if !strings.HasPrefix(k, "gpu_") {
			out[k] = v
		}
	}
	for i, g := range sample.GPUs {
		target, ok := targets[g.Name]
		if !ok {
			continue
		}
		from, to := fmt.Sprintf("gpu_%d", i), fmt.Sprintf("gpu_%d", target)
		for _, suffix := range []string{"", "_memory_percent", "_shared_percent", "_temperature"} {
			if v, ok := values[from+suffix]; ok {
				out[to+suffix] = v
			}
		}
	}
	return out
}
