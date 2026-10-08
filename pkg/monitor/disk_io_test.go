package monitor

import (
	"context"
	"github.com/nezhahq/agent/pkg/monitor/disk"
	"testing"
)

func TestGetStateCarriesDiskIO(t *testing.T) {
	original := diskIOStateProbe
	t.Cleanup(func() { diskIOStateProbe = original })
	diskIOStateProbe = func(context.Context) disk.IOState {
		return disk.IOState{ReadSpeed: 123, WriteSpeed: 456, Available: true}
	}
	got := GetState(nil, true, true)
	if got.DiskReadSpeed != 123 || got.DiskWriteSpeed != 456 || !got.DiskIOAvailable {
		t.Fatalf("%+v", got)
	}
}
