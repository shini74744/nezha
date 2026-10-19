package model

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestHardwareProtocolAndSnapshot(t *testing.T) {
	s := HostState{CPU: 10, CPUFrequencyMHz: 2800, CPUFrequencyKind: "reported", GPU: []float64{5, 0}, GPUs: []GPUStat{{Name: "Intel [1]", Utilization: 5, SharedMemoryTotal: 8192, SharedMemoryUsed: 1024}, {Name: "NVIDIA [2]", MemoryTotal: 4096, MemoryUsed: 512}}, Temperatures: []SensorTemperature{{Name: "ACPI\\ThermalZone", Temperature: 99}, {Name: "coretemp_core_0", Temperature: 56}, {Name: "GPU Core / NVIDIA [2]", Temperature: 45}}}
	got := PB2State(s.PB())
	if !reflect.DeepEqual(got.GPUs, s.GPUs) || got.CPUFrequencyMHz != 2800 || got.CPUFrequencyKind != "reported" {
		t.Fatalf("%+v", got)
	}
	r := RecordedServerState{At: 1000, State: &s}
	raw, e := json.Marshal(r)
	if e != nil {
		t.Fatal(e)
	}
	var saved RecordedServerState
	if e = json.Unmarshal(raw, &saved); e != nil {
		t.Fatal(e)
	}
	metrics := saved.Metrics()
	for k, v := range map[string]float64{"cpu_frequency_mhz": 2800, "cpu_temperature": 56, "gpu_0_shared_percent": 12.5, "gpu_1_memory_percent": 12.5, "gpu_1_temperature": 45} {
		if metrics[k] != v {
			t.Fatalf("%s: %v", k, metrics[k])
		}
	}
	if _, ok := metrics["gpu_0_temperature"]; ok {
		t.Fatal("wrong GPU sensor association")
	}
	s.CPUFrequencyMHz = 4000
	s.GPUs[1].MemoryUsed = 2048
	if saved.Metrics()["cpu_frequency_mhz"] != 2800 || saved.Metrics()["gpu_1_memory_percent"] != 12.5 {
		t.Fatal("snapshot changed")
	}
}
func TestHardwareMetricsUnsupported(t *testing.T) {
	s := HostState{Temperatures: []SensorTemperature{{Name: "ACPI\\ThermalZone", Temperature: 99}}, GPUs: []GPUStat{{MemoryUsed: 9999, MemoryTotal: 4096}}, CPUFrequencyMHz: 2000, CPUFrequencyKind: "unknown"}
	m := (RecordedServerState{State: &s}).Metrics()
	for _, key := range []string{"cpu_temperature", "cpu_frequency_mhz", "gpu_0_memory_percent"} {
		if _, ok := m[key]; ok {
			t.Fatal("invented reading", key)
		}
	}
}

func TestHardwareSnapshotAdapterReorder(t *testing.T) {
	before := HostState{GPU: []float64{10, 70}, GPUs: []GPUStat{{Name: "Intel [1]", SharedMemoryUsed: 1024, SharedMemoryTotal: 8192}, {Name: "RTX [2]", MemoryUsed: 2048, MemoryTotal: 4096}}}
	latest := HostState{GPU: []float64{75}, GPUs: []GPUStat{{Name: "RTX [2]", MemoryUsed: 3072, MemoryTotal: 4096}}}
	aligned := AlignSnapshotGPU((RecordedServerState{State: &before}).Metrics(), &before, &latest)
	if aligned["gpu_0"] != 70 || aligned["gpu_0_memory_percent"] != 50 {
		t.Fatal(aligned)
	}
	if _, ok := aligned["gpu_0_shared_percent"]; ok {
		t.Fatal("Intel memory attributed to RTX", aligned)
	}
	legacy := HostState{GPU: []float64{50}}
	aligned = AlignSnapshotGPU((RecordedServerState{State: &legacy}).Metrics(), &legacy, &latest)
	if _, ok := aligned["gpu_0"]; ok {
		t.Fatal("unnamed old sample guessed")
	}
}

func TestHardwareCPUSensorPlatformNames(t *testing.T) {
	for _, name := range []string{"TC0D", "pACC MTR Temp Sensor0", "eACC MTR Temp Sensor12", "CPU Core 0", "k10temp_tdie"} {
		v, ok := cpuSensorTemperature([]SensorTemperature{{Name: name, Temperature: 55}})
		if !ok || v != 55 {
			t.Fatal(name, v, ok)
		}
	}
	for _, name := range []string{"TC0H", "TC0P", "PMU tdie1", "CPU Heatsink", "CPU Proximity", "GPU MTR Temp Sensor0", "ACPI ThermalZone"} {
		if _, ok := cpuSensorTemperature([]SensorTemperature{{Name: name, Temperature: 55}}); ok {
			t.Fatal("non-core sensor", name)
		}
	}
}
