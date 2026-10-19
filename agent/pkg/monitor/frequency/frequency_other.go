//go:build !linux && !windows && !freebsd

package frequency

import (
	"context"
	"github.com/shirou/gopsutil/v4/cpu"
	"runtime"
)

func read(ctx context.Context) Reading {
	info, e := cpu.InfoWithContext(ctx)
	if e != nil {
		return Reading{}
	}
	values := make([]float64, 0, len(info))
	for _, v := range info {
		values = append(values, v.Mhz)
	}
	kind := "reported"
	if runtime.GOOS == "darwin" {
		kind = "nominal"
	}
	return average(values, kind)
}
