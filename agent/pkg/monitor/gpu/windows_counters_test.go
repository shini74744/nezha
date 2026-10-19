package gpu

import (
	"math"
	"testing"
)

func TestWindowsCountersSeparateAdapters(t *testing.T) {
	a := []windowsAdapter{{"00000000:00000001", "Intel", 128 << 20, 8192 << 20}, {"00000000:00000002", "NVIDIA", 4096 << 20, 8192 << 20}}
	c := map[string][]windowsCounterSample{
		"util":      {{"pid_1_luid_0x0_0x1_phys_0_eng_0_engtype_3D", 10}, {"pid_2_luid_0x0_0x1_phys_0_eng_0_engtype_3D", 20}, {"pid_3_luid_0x0_0x1_phys_0_eng_1_engtype_Copy", 15}, {"pid_1_luid_0x0_0x2_phys_0_eng_0_engtype_3D", 0}},
		"dedicated": {{"luid_0x0_0x1_phys_0", 32 << 20}, {"luid_0x0_0x2_phys_0", 512 << 20}},
		"shared":    {{"luid_0x0_0x1_phys_0", 1024 << 20}, {"luid_0x0_0x2_phys_0", 0}}}
	g := windowsGPUStats(a, c)
	if len(g) != 2 || g[0].Utilization != 30 || g[1].Utilization != 0 || g[0].SharedMemoryUsed != 1024 || g[1].MemoryUsed != 512 || g[1].MemoryTotal != 4096 || g[0].Name == g[1].Name {
		t.Fatalf("%+v", g)
	}
	c["dedicated"][0].Value = math.NaN()
	g = windowsGPUStats(a, c)
	if g[0].MemoryTotal != 0 {
		t.Fatal(g)
	}
	if g := windowsGPUStats(a, nil); len(g) != 0 {
		t.Fatal("missing counters", g)
	}
}
func TestWindowsIdentityNeverGuesses(t *testing.T) {
	a := []windowsAdapter{{ID: "1", Name: "RTX"}, {ID: "2", Name: "Intel"}}
	if adapterLabelForNvidia("RTX", a, []string{"RTX"}) != "RTX [1]" {
		t.Fatal("unique")
	}
	if adapterLabelForNvidia("RTX", a, []string{"RTX", "RTX"}) != "" {
		t.Fatal("duplicate query")
	}
	a = append(a, windowsAdapter{ID: "3", Name: "RTX"})
	if adapterLabelForNvidia("RTX", a, []string{"RTX"}) != "" {
		t.Fatal("duplicate adapter")
	}
}
