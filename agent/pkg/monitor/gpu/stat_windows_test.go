//go:build windows

package gpu

import (
	"context"
	"errors"
	"fmt"
	"github.com/nezhahq/agent/pkg/monitor/frequency"
	"github.com/nezhahq/agent/pkg/monitor/gpu/nvidiasnapshot"
	"os"
	"testing"
)

func TestWindowsFallbackRecovery(t *testing.T) {
	oldA, oldC, oldN, oldF := windowsAdapterProbe, windowsCounterProbe, windowsNvidia, windowsGPUFallback
	defer func() {
		windowsAdapterProbe, windowsCounterProbe, windowsNvidia, windowsGPUFallback = oldA, oldC, oldN, oldF
	}()
	windowsAdapterProbe = func() ([]windowsAdapter, error) { return nil, errors.New("none") }
	windowsNvidia = nvidiasnapshot.New(func(context.Context) ([]byte, error) { return nil, errors.New("none") })
	windowsGPUFallback = func(context.Context) ([]float64, error) { return nil, errors.New("none") }
	for range 5 {
		g, handled, e := detailedStat(context.Background())
		if e != nil || !handled || len(g) != 0 {
			t.Fatal(g, handled, e)
		}
	}
	windowsNvidia = nvidiasnapshot.New(func(context.Context) ([]byte, error) { return []byte("0000:01:00.0, NVIDIA Test, 0, 0, 4096, 45"), nil })
	g, _, e := detailedStat(context.Background())
	if e != nil || len(g) != 1 || g[0].MemoryTotal != 4096 {
		t.Fatal(g, e)
	}
	temps := GetCoreTemperatures(context.Background())
	if len(temps) != 1 || temps[0].Name != "GPU Core / "+g[0].Name {
		t.Fatal(temps)
	}
}
func TestHardwareReadOnly(t *testing.T) {
	if os.Getenv("DDNZ_HARDWARE_TEST") != "1" {
		t.Skip("explicit opt-in required")
	}
	a, e := listWindowsAdapters()
	if e != nil {
		t.Fatal(e)
	}
	fmt.Printf("DXGI adapters: %+v\n", a)
	c, e := readWindowsGPUCounters(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	g := windowsGPUStats(a, c)
	fmt.Printf("GPU readings: %+v\n", g)
	if len(g) < 2 {
		t.Fatalf("this dual-GPU acceptance host returned only %d adapters", len(g))
	}
	for _, v := range g {
		if v.Name == "" || v.MemoryTotal == 0 && v.SharedMemoryTotal == 0 {
			t.Fatal(v)
		}
	}
	temp := GetCoreTemperatures(context.Background())
	fmt.Printf("GPU core sensors: %+v\n", temp)
	if len(temp) == 0 {
		t.Fatal("expected NVIDIA core temperature on this acceptance host")
	}
	f := frequency.Get(context.Background())
	fmt.Printf("CPU frequency: %+v\n", f)
	if f.MHz <= 0 || f.Kind != "reported" {
		t.Fatal(f)
	}
}
