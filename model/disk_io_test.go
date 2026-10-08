package model

import (
	"encoding/json"
	pb "github.com/nezhahq/nezha/proto"
	"google.golang.org/protobuf/proto"
	"testing"
)

func TestDiskIOWireAndSnapshot(t *testing.T) {
	input := &HostState{DiskUsed: 123, DiskReadSpeed: 4096, DiskWriteSpeed: 8192, DiskIOAvailable: true}
	encoded, err := proto.Marshal(input.PB())
	if err != nil {
		t.Fatal(err)
	}
	var wire pb.State
	if err = proto.Unmarshal(encoded, &wire); err != nil {
		t.Fatal(err)
	}
	output := PB2State(&wire)
	if output.DiskReadSpeed != 4096 || output.DiskWriteSpeed != 8192 || !output.DiskIOAvailable || output.DiskUsed != 123 {
		t.Fatalf("%+v", output)
	}
	snapshot := RecordedServerState{At: 1000, State: &output}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	var restored RecordedServerState
	if err = json.Unmarshal(raw, &restored); err != nil {
		t.Fatal(err)
	}
	if restored.Metrics()["disk_read_speed"] != 4096 {
		t.Fatal("snapshot lost read speed")
	}
	legacy := PB2State(&pb.State{DiskUsed: 5})
	if legacy.DiskIOAvailable {
		t.Fatal("legacy report claimed disk IO")
	}
	if _, ok := (RecordedServerState{State: &legacy}).Metrics()["disk_read_speed"]; ok {
		t.Fatal("missing IO recorded as zero")
	}
	idle := RecordedServerState{State: &HostState{DiskIOAvailable: true}}
	if value, ok := idle.Metrics()["disk_write_speed"]; !ok || value != 0 {
		t.Fatal("idle zero missing")
	}
}
