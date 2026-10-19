package model

import (
	"encoding/json"
	"testing"

	pb "github.com/nezhahq/nezha/proto"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"
)

func TestGPUMemoryWireSnapshotAndIsolation(t *testing.T) {
	input := &HostState{GPU: []float64{33, 55}, GPUs: []GPUStat{
		{Utilization: 33, MemoryUsed: 2048, MemoryTotal: 8192},
		{Utilization: 55, MemoryUsed: 0, MemoryTotal: 24576},
	}}
	raw, err := proto.Marshal(input.PB())
	require.NoError(t, err)
	var wire pb.State
	require.NoError(t, proto.Unmarshal(raw, &wire))
	output := PB2State(&wire)
	require.Equal(t, input.GPUs, output.GPUs)
	require.Equal(t, input.GPU, output.GPU)
	frozen := cloneHostState(&output)
	output.GPUs[0].MemoryUsed = 4096
	output.GPU[0] = 99
	require.EqualValues(t, 2048, frozen.GPUs[0].MemoryUsed)
	require.Equal(t, 33.0, frozen.GPU[0])
	saved := RecordedServerState{At: 1000, Host: &Host{GPU: []string{"T4", "A10"}}, State: frozen}
	raw, err = json.Marshal(saved)
	require.NoError(t, err)
	var restored RecordedServerState
	require.NoError(t, json.Unmarshal(raw, &restored))
	require.Equal(t, saved, restored)
	require.Contains(t, string(raw), `"memory_total":24576`)
	require.NotContains(t, string(raw), `"memory_used":0`)
	legacy := PB2State(&pb.State{Gpu: []float64{10}})
	require.Empty(t, legacy.GPUs)
	require.Equal(t, []float64{10}, legacy.GPU)
}
