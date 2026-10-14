package disk

import (
	"context"
	"errors"
	psDisk "github.com/shirou/gopsutil/v4/disk"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestIOSamplerRatesAndAvailability(t *testing.T) {
	var s ioSampler
	at := time.Unix(100, 0)
	counters := map[string]psDisk.IOCountersStat{"sda": {ReadBytes: 100, WriteBytes: 200}}
	var probeErr error
	sample := func() IOState {
		return s.sample(context.Background(), func(context.Context) (map[string]psDisk.IOCountersStat, error) { return counters, probeErr }, func() time.Time { return at })
	}
	if got := sample(); got.Available {
		t.Fatal("first sample must warm up")
	}
	at = at.Add(2 * time.Second)
	counters = map[string]psDisk.IOCountersStat{"sda": {ReadBytes: 1124, WriteBytes: 2248}}
	if got := sample(); got != (IOState{512, 1024, true}) {
		t.Fatalf("rates: %+v", got)
	}
	at = at.Add(time.Second)
	if got := sample(); got != (IOState{0, 0, true}) {
		t.Fatalf("idle: %+v", got)
	}
	at = at.Add(time.Second)
	counters = map[string]psDisk.IOCountersStat{"sda": {ReadBytes: 1, WriteBytes: 1}}
	if got := sample(); got.Available || got.ReadSpeed != 0 || got.WriteSpeed != 0 {
		t.Fatalf("reset: %+v", got)
	}
	at = at.Add(time.Second)
	counters = map[string]psDisk.IOCountersStat{"sda": {ReadBytes: 101, WriteBytes: 201}, "sdb": {ReadBytes: 999999, WriteBytes: 999999}}
	if got := sample(); got != (IOState{100, 200, true}) {
		t.Fatalf("new device: %+v", got)
	}
	probeErr = errors.New("unavailable")
	if got := sample(); got.Available {
		t.Fatal("error must be unavailable")
	}
	probeErr = nil
	at = at.Add(time.Second)
	if got := sample(); got.Available {
		t.Fatal("recovery must rebaseline")
	}
	at = at.Add(time.Second)
	if got := sample(); got != (IOState{0, 0, true}) {
		t.Fatalf("recovered: %+v", got)
	}
	counters = map[string]psDisk.IOCountersStat{}
	if got := sample(); got.Available {
		t.Fatal("empty counters must be unavailable")
	}
}

func TestIOSamplerConcurrent(t *testing.T) {
	var s ioSampler
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 20; j++ {
				s.sample(context.Background(), func(context.Context) (map[string]psDisk.IOCountersStat, error) {
					return map[string]psDisk.IOCountersStat{"sda": {ReadBytes: 1}}, nil
				}, time.Now)
			}
		}()
	}
	wg.Wait()
}

func TestSelectIOCountersDoesNotDoubleCount(t *testing.T) {
	root := t.TempDir()
	counters := map[string]psDisk.IOCountersStat{}
	for _, name := range []string{"sda", "sda1", "nvme0n1", "nvme0n1p1", "dm-0", "md0", "loop0", "ram0", "zram0", "missing"} {
		counters[name] = psDisk.IOCountersStat{ReadBytes: 100}
		if name == "missing" {
			continue
		}
		base := filepath.Join(root, "class", "block", name)
		if err := os.MkdirAll(filepath.Join(base, "slaves"), 0700); err != nil {
			t.Fatal(err)
		}
		if name == "sda1" || name == "nvme0n1p1" {
			if err := os.WriteFile(filepath.Join(base, "partition"), []byte("1"), 0600); err != nil {
				t.Fatal(err)
			}
		}
		if name == "dm-0" || name == "md0" {
			if err := os.WriteFile(filepath.Join(base, "slaves", "sda"), nil, 0600); err != nil {
				t.Fatal(err)
			}
		}
	}
	selected := selectIOCounters(counters, "linux", root)
	if len(selected) != 2 {
		t.Fatalf("wanted only whole leaf disks, got %v", selected)
	}
	for _, name := range []string{"sda", "nvme0n1"} {
		if _, ok := selected[name]; !ok {
			t.Fatal(name)
		}
	}
	if got := selectIOCounters(counters, "windows", root); len(got) != len(counters) {
		t.Fatal("non-Linux counters altered")
	}
}
