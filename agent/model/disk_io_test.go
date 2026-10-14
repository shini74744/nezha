package model

import "testing"

func TestHostStateDiskIOPB(t *testing.T) {
	got := (&HostState{DiskReadSpeed: 4096, DiskWriteSpeed: 8192, DiskIOAvailable: true, DiskUsed: 123}).PB()
	if got.GetDiskReadSpeed() != 4096 || got.GetDiskWriteSpeed() != 8192 || !got.GetDiskIoAvailable() || got.GetDiskUsed() != 123 {
		t.Fatalf("%+v", got)
	}
	if (&HostState{}).PB().GetDiskIoAvailable() {
		t.Fatal("missing must not be available")
	}
}
