package singleton

import (
	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func TestHardwareSnapshotReordersWithoutMixing(t *testing.T) {
	uuid, _ := snapshotFixture(t)
	at := time.Now().Add(-90 * 24 * time.Hour).UnixMilli()
	sample := sampleAt(at)
	sample.State.CPUFrequencyMHz = 2800
	sample.State.CPUFrequencyKind = "reported"
	sample.State.GPU = []float64{10, 70}
	sample.State.GPUs = []model.GPUStat{{Name: "Intel [1]", SharedMemoryUsed: 1024, SharedMemoryTotal: 8192}, {Name: "RTX [2]", MemoryUsed: 512, MemoryTotal: 4096}}
	sample.State.Temperatures = []model.SensorTemperature{{Name: "GPU Core / RTX [2]", Temperature: 45}}
	require.NoError(t, PersistServerSnapshot(11, uuid, sample))
	sample.At += 1000
	sample.State.CPUFrequencyMHz = 3200
	sample.State.GPU = []float64{80}
	sample.State.GPUs = sample.State.GPUs[1:]
	sample.State.GPUs[0].MemoryUsed = 1024
	require.NoError(t, PersistServerSnapshot(11, uuid, sample))
	sample.State.GPUs[0].MemoryUsed = 4096
	sample.State.CPUFrequencyMHz = 9000
	saved, e := QueryServerSnapshot(11, uuid, 1)
	require.NoError(t, e)
	require.Equal(t, 3200.0, saved.Metrics["cpu_frequency_mhz"])
	require.Equal(t, 25.0, saved.Metrics["gpu_0_memory_percent"])
	require.Equal(t, 70.0, saved.Recent["gpu_0"][0].Value)
	require.Equal(t, 12.5, saved.Recent["gpu_0_memory_percent"][0].Value)
	require.Equal(t, 45.0, saved.Recent["gpu_0_temperature"][0].Value)
	require.NotContains(t, saved.Recent, "gpu_0_shared_percent")
	again, e := QueryServerSnapshot(11, uuid, 1)
	require.NoError(t, e)
	require.Equal(t, saved, again)
}
