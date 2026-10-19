package temperature

import (
	"context"
	"fmt"
	"github.com/nezhahq/agent/model"
)

func readBSDTemperatures(ctx context.Context, query func(string) (uint32, error)) []model.SensorTemperature {
	count, _ := query("hw.ncpu")
	if count > 4096 {
		count = 4096
	}
	if count == 0 {
		count = 1
	}
	var out []model.SensorTemperature
	for i := uint32(0); i < count; i++ {
		if ctx.Err() != nil {
			break
		}
		raw, err := query(fmt.Sprintf("dev.cpu.%d.temperature", i))
		if err != nil {
			continue
		}
		// FreeBSD's IK sysctl temperature is an integer in decikelvin, not Celsius.
		c := float64(raw)/10 - 273.15
		if c > 0 && c <= 150 {
			out = append(out, model.SensorTemperature{Name: fmt.Sprintf("CPU Core %d", i), Temperature: c})
		}
	}
	return out
}
