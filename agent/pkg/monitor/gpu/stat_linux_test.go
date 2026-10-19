//go:build linux

package gpu

import (
	"context"
	"errors"
	"github.com/nezhahq/agent/pkg/monitor/gpu/nvidiasnapshot"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func linuxFixture(t *testing.T) (string, func(string, string)) {
	t.Helper()
	root := t.TempDir()
	oldRoot, oldNV, oldIntel, oldVendor := linuxDRMRoot, linuxNvidia, linuxIntelUsage, vendorType
	t.Cleanup(func() {
		linuxDRMRoot = oldRoot
		linuxNvidia = oldNV
		linuxIntelUsage = oldIntel
		vendorType = oldVendor
	})
	linuxDRMRoot = func() string { return root }
	linuxNvidia = nvidiasnapshot.New(func(context.Context) ([]byte, error) { return nil, errors.New("no NVIDIA") })
	linuxIntelUsage = func(context.Context, string) (float64, error) { return 0, errors.New("no Intel") }
	vendorType = 0
	write := func(p, v string) {
		p = filepath.Join(root, p)
		if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(v), 0644); err != nil {
			t.Fatal(err)
		}
	}
	return root, write
}
func TestLinuxMixedGPUsAndTemperatureIdentity(t *testing.T) {
	_, write := linuxFixture(t)
	write("card0/device/uevent", "PCI_SLOT_NAME=0000:00:02.0")
	write("card0/device/vendor", "0x8086")
	write("card1/device/uevent", "PCI_SLOT_NAME=0000:01:00.0")
	write("card1/device/vendor", "0x1002")
	write("card1/device/product_name", "Radeon Test")
	write("card1/device/gpu_busy_percent", "25")
	write("card1/device/mem_info_vram_used", "1073741824")
	write("card1/device/mem_info_vram_total", "8589934592")
	write("card1/device/hwmon/hwmon0/name", "amdgpu")
	write("card1/device/hwmon/hwmon0/temp1_input", "53000")
	write("card1/device/hwmon/hwmon0/temp2_input", "110000") // Hotspot must not replace core/edge.
	write("card2/device/uevent", "PCI_SLOT_NAME=0000:02:00.0")
	write("card2/device/vendor", "0x10de")
	// Duplicate DRM path and a display connector must not create extra GPUs.
	write("card3/device/uevent", "PCI_SLOT_NAME=0000:01:00.0")
	write("card3/device/vendor", "0x1002")
	write("card1-HDMI-A-1/device/uevent", "PCI_SLOT_NAME=0000:01:00.0")
	linuxNvidia = nvidiasnapshot.New(func(context.Context) ([]byte, error) {
		return []byte("00000000:02:00.0, NVIDIA Test, 35, 512, 4096, 42\n"), nil
	})
	called := 0
	linuxIntelUsage = func(_ context.Context, node string) (float64, error) {
		called++
		if node != "/dev/dri/card0" {
			t.Fatal(node)
		}
		return 0, nil
	}
	stats, handled, err := detailedStat(context.Background())
	if err != nil || !handled || len(stats) != 3 {
		t.Fatalf("%+v %v %v", stats, handled, err)
	}
	got := map[string]bool{}
	for _, s := range stats {
		got[s.Name] = true
		if strings.HasPrefix(s.Name, "Intel") && (s.Utilization != 0 || s.MemoryTotal != 0) {
			t.Fatal(s)
		}
		if strings.HasPrefix(s.Name, "Radeon") && (s.MemoryUsed != 1024 || s.MemoryTotal != 8192 || s.Utilization != 25) {
			t.Fatal(s)
		}
	}
	if called != 1 {
		t.Fatal(called)
	}
	temps := GetCoreTemperatures(context.Background())
	if len(temps) != 2 {
		t.Fatal(temps)
	}
	for _, v := range temps {
		if !got[strings.TrimPrefix(v.Name, nvidiasnapshot.TemperaturePrefix)] {
			t.Fatal("wrong GPU", v)
		}
		if v.Temperature != 42 && v.Temperature != 53 {
			t.Fatal(v)
		}
	}
	if called != 1 {
		t.Fatal("temperature spawned Intel query")
	}
}
func TestLinuxMissingReadingsNeverInventOrReuse(t *testing.T) {
	_, write := linuxFixture(t)
	write("card0/device/uevent", "PCI_SLOT_NAME=0000:01:00.0")
	write("card0/device/vendor", "0x1002")
	write("card0/device/gpu_busy_percent", "NaN")
	stats, handled, err := detailedStat(context.Background())
	if len(stats) != 0 || !handled || err != nil {
		t.Fatal(stats, handled, err)
	}
	write("card0/device/gpu_busy_percent", "0")
	write("card0/device/mem_info_vram_used", "9999999999")
	write("card0/device/mem_info_vram_total", "100")
	stats, _, _ = detailedStat(context.Background())
	if len(stats) != 1 || stats[0].Utilization != 0 || stats[0].MemoryTotal != 0 {
		t.Fatal(stats)
	}
	write("card0/device/gpu_busy_percent", "-1")
	stats, _, _ = detailedStat(context.Background())
	if len(stats) != 0 {
		t.Fatal("stale GPU", stats)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if v, _, _ := detailedStat(ctx); len(v) != 0 {
		t.Fatal(v)
	}
	if v := GetCoreTemperatures(ctx); len(v) != 0 {
		t.Fatal(v)
	}
}
func TestLinuxNoGPUKeepsLegacyFallback(t *testing.T) {
	linuxFixture(t)
	v, handled, e := detailedStat(context.Background())
	if len(v) != 0 || handled || e != nil {
		t.Fatal(v, handled, e)
	}
}
func TestLinuxHostSysAndBoundedNvidiaOutput(t *testing.T) {
	original := linuxDRMRoot
	defer func() { linuxDRMRoot = original }()
	// Test the default mount convention separately from fixture injection.
	t.Setenv("HOST_SYS", t.TempDir())
	if linuxDRMRoot() != filepath.Join(os.Getenv("HOST_SYS"), "class/drm") {
		t.Fatal("HOST_SYS ignored")
	}
	var out linuxGPUOutput
	if _, err := out.Write(make([]byte, nvidiasnapshot.MaxOutput+1)); err == nil || out.Len() != 0 {
		t.Fatal("unbounded output")
	}
}

func TestLinuxVendorDetectionNeverExecutesTools(t *testing.T) {
	path := filepath.Join(t.TempDir(), "query-tool")
	marker := path + ".executed"
	if err := os.WriteFile(path, []byte("#!/bin/sh\ntouch "+marker+"\nexit 0\n"), 0700); err != nil {
		t.Fatal(err)
	}
	if !linuxToolAvailable(path) {
		t.Fatal("tool not detected")
	}
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatal("detection executed tool", err)
	}
}
