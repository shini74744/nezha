package temperature

import (
	"context"
	"errors"
	"math"
	"testing"
)

func TestBSDCoreTemperatureOnly(t *testing.T) {
	data := map[string]uint32{"hw.ncpu": 4, "dev.cpu.0.temperature": 3132, "dev.cpu.2.temperature": 3432, "dev.cpu.3.temperature": 0}
	calls := []string{}
	query := func(k string) (uint32, error) {
		calls = append(calls, k)
		v, ok := data[k]
		if !ok {
			return 0, errors.New("no sensor")
		}
		return v, nil
	}
	v := readBSDTemperatures(context.Background(), query)
	if len(v) != 2 || v[0].Name != "CPU Core 0" || math.Abs(v[0].Temperature-40.05) > 0.001 || v[1].Name != "CPU Core 2" {
		t.Fatal(v)
	}
	for _, k := range calls {
		if k != "hw.ncpu" && k != "dev.cpu.0.temperature" && k != "dev.cpu.1.temperature" && k != "dev.cpu.2.temperature" && k != "dev.cpu.3.temperature" {
			t.Fatal(k)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if len(readBSDTemperatures(ctx, query)) != 0 {
		t.Fatal("canceled read")
	}
}
