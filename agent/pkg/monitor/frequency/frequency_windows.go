package frequency

import (
	"context"
	"golang.org/x/sys/windows"
	"unsafe"
)

var powerInfo = windows.NewLazySystemDLL("powrprof.dll").NewProc("CallNtPowerInformation")
var processorCount = windows.NewLazySystemDLL("kernel32.dll").NewProc("GetActiveProcessorCount")

type processorPower struct{ Number, MaxMHz, CurrentMHz, LimitMHz, MaxIdle, CurrentIdle uint32 }

func read(ctx context.Context) Reading {
	if powerInfo.Find() != nil || processorCount.Find() != nil {
		return Reading{}
	}
	n, _, _ := processorCount.Call(0xffff)
	if n == 0 || n > 4096 {
		return Reading{}
	}
	values := make([]processorPower, int(n))
	status, _, _ := powerInfo.Call(11, 0, 0, uintptr(unsafe.Pointer(&values[0])), uintptr(len(values))*unsafe.Sizeof(values[0]))
	if status != 0 || ctx.Err() != nil {
		return Reading{}
	}
	mhz := make([]float64, 0, len(values))
	for _, v := range values {
		mhz = append(mhz, float64(v.CurrentMHz))
	}
	// Windows returns maximum specified clock multiplied by current throttle, not turbo telemetry.
	return average(mhz, "reported")
}
