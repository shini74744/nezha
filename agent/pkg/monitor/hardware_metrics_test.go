package monitor

import (
	"context"
	"github.com/nezhahq/agent/model"
	"github.com/nezhahq/agent/pkg/monitor/frequency"
	"github.com/nezhahq/agent/pkg/monitor/gpu/vendor"
	"testing"
)

func TestHardwareFrequencyAndIdentityWire(t *testing.T) {
	old := captureMonitorTestState()
	t.Cleanup(old.restore)
	stateLock.Lock()
	statDataFetchAttempts[GPU] = 0
	stateLock.Unlock()
	cpuFrequencyProbe = func(context.Context) frequency.Reading { return frequency.Reading{MHz: 2800, Kind: "reported"} }
	gpuStatProbe = func(context.Context) ([]vendor.GPUStat, error) {
		return []vendor.GPUStat{{Name: "Intel [1]", SharedMemoryUsed: 1024, SharedMemoryTotal: 8192}}, nil
	}
	got := GetState(&model.AgentConfig{GPU: true}, true, true).PB()
	if got.CpuFrequencyMhz != 2800 || got.CpuFrequencyKind != "reported" || got.Gpus[0].Name != "Intel [1]" || got.Gpus[0].SharedMemoryUsed != 1024 || got.Gpus[0].SharedMemoryTotal != 8192 {
		t.Fatal(got)
	}
	cpuFrequencyProbe = func(context.Context) frequency.Reading { return frequency.Reading{} }
	got = GetState(&model.AgentConfig{GPU: false}, true, true).PB()
	if got.CpuFrequencyMhz != 0 || got.CpuFrequencyKind != "" || len(got.Gpus) != 0 {
		t.Fatal("reused stale readings", got)
	}
}
