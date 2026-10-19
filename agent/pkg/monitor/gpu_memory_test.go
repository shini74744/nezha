package monitor

import (
	"context"
	"errors"
	"testing"

	"github.com/nezhahq/agent/model"
	"github.com/nezhahq/agent/pkg/monitor/gpu/vendor"
)

func TestGPUMemoryCollectionAndWire(t *testing.T) {
	original := captureMonitorTestState()
	t.Cleanup(original.restore)
	stateLock.Lock()
	statDataFetchAttempts[GPU] = 0
	stateLock.Unlock()
	calls := 0
	gpuStatProbe = func(context.Context) ([]vendor.GPUStat, error) {
		calls++
		return []vendor.GPUStat{
			{Utilization: 33, MemoryUsed: 1937, MemoryTotal: 6144},
			{Utilization: 0, MemoryUsed: 0, MemoryTotal: 24576},
		}, nil
	}
	enabled := GetState(&model.AgentConfig{GPU: true}, true, true)
	wire := enabled.PB()
	if calls != 1 || len(wire.Gpus) != 2 || len(wire.Gpu) != 2 {
		t.Fatalf("one probe must feed both per-card fields; calls=%d state=%+v", calls, wire)
	}
	if wire.Gpus[0].MemoryUsed != 1937 || wire.Gpus[0].MemoryTotal != 6144 || wire.Gpu[0] != 33 {
		t.Fatalf("first GPU mismatch: %+v", wire)
	}
	if wire.Gpus[1].MemoryUsed != 0 || wire.Gpus[1].MemoryTotal != 24576 || wire.Gpu[1] != 0 {
		t.Fatalf("idle GPU mismatch: %+v", wire)
	}
	disabled := GetState(&model.AgentConfig{GPU: false}, true, true)
	if calls != 1 || len(disabled.GPUs) != 0 || len(disabled.GPU) != 0 {
		t.Fatal("disabled monitoring must neither probe nor reuse old GPU values")
	}
	gpuStatProbe = func(context.Context) ([]vendor.GPUStat, error) {
		return nil, errors.New("simulated GPU unavailable")
	}
	failed := GetState(&model.AgentConfig{GPU: true}, true, true)
	if len(failed.GPUs) != 0 || len(failed.GPU) != 0 {
		t.Fatal("failed probe must not reuse old GPU memory")
	}
}
