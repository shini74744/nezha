package frequency

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLinuxSources(t *testing.T) {
	oldSys, oldProc := sysCPU, procCPU
	t.Cleanup(func() { sysCPU, procCPU = oldSys, oldProc })
	dir := t.TempDir()
	sysCPU = dir
	procCPU = filepath.Join(dir, "cpuinfo")
	if err := os.WriteFile(procCPU, []byte("cpu MHz : 1200\ncpu MHz : 2400\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if r := Get(context.Background()); r.MHz != 1800 || r.Kind != "reported" {
		t.Fatal(r)
	}
	path := filepath.Join(dir, "cpu0", "cpufreq")
	os.MkdirAll(path, 0700)
	os.WriteFile(filepath.Join(path, "scaling_cur_freq"), []byte("2800000"), 0600)
	if r := Get(context.Background()); r.MHz != 2800 || r.Kind != "reported" {
		t.Fatal(r)
	}
	os.WriteFile(filepath.Join(path, "cpuinfo_cur_freq"), []byte("3200000"), 0600)
	if r := Get(context.Background()); r.MHz != 3200 || r.Kind != "current" {
		t.Fatal(r)
	}
}
func TestCPUInfoNoFabrication(t *testing.T) {
	r := parseCPUInfo(context.Background(), strings.NewReader("model name: 5 GHz\nclock: 5000\ncpu MHz : NaN\n"))
	if r != (Reading{}) {
		t.Fatal(r)
	}
}
