package frequency

import (
	"context"
	"fmt"
)

// Kept independent of the syscall so fallback and failure behavior is tested on all platforms.
func readBSD(ctx context.Context, query func(string) (uint32, error)) Reading {
	count, _ := query("hw.ncpu")
	if count > 4096 {
		count = 4096
	}
	if count == 0 {
		count = 1
	}
	var values []float64
	for i := uint32(0); i < count; i++ {
		if ctx.Err() != nil {
			return Reading{}
		}
		v, err := query(fmt.Sprintf("dev.cpu.%d.freq", i))
		if err == nil {
			values = append(values, float64(v))
		}
	}
	if r := average(values, "reported"); r.MHz > 0 {
		return r
	}
	v, err := query("hw.clockrate")
	if err != nil || ctx.Err() != nil {
		return Reading{}
	}
	return average([]float64{float64(v)}, "nominal")
}
