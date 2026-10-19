package vendor

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestIntelTextEngineParsing(t *testing.T) {
	engines := []string{"RCS", "BCS"}
	for _, tc := range []struct {
		row   string
		value float64
		ok    bool
	}{
		{"300 200 20 0 0 40 0 0", 40, true},
		{"300 200 0 0 0 0 0 0", 0, true},
		{"300 200 --- 0 0 --- 0 0", 0, false},
		{"300 200 NaN 0 0 +Inf 0 0", 0, false},
		{"300 200 101 0 0 -1 0 0", 0, false},
		{"300 200 20", 0, false},
	} {
		got, err := parseIntelDataRow(tc.row, engines, 2)
		if (err == nil) != tc.ok || got != tc.value {
			t.Fatalf("%q: %v %v", tc.row, got, err)
		}
	}
	if _, err := parseIntelDataRow("300 200", nil, 2); err == nil {
		t.Fatal("no engine invented")
	}
}
func TestIntelSpecificDeviceAndTimeout(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX fixture")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "intel_gpu_top")
	argsFile := filepath.Join(dir, "args")
	script := "#!/bin/sh\nprintf '%s\\n' \"$@\" > " + argsFile + "\nprintf 'Freq MHz RCS/0\\nreq act %% %% %%\\n300 200 0 0 0\\n300 200 37 0 0\\n'\n"
	if err := os.WriteFile(path, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	probe := IntelGPUTop{BinPath: path, Device: "/dev/dri/card7"}
	usage, err := probe.collectStats(context.Background())
	if err != nil || usage != 37 {
		t.Fatal(usage, err)
	}
	args, _ := os.ReadFile(argsFile)
	if !strings.Contains(string(args), "-d\ndrm:/dev/dri/card7\n") {
		t.Fatal(string(args))
	}
	if err := os.WriteFile(path, []byte("#!/bin/sh\nexec sleep 30\n"), 0700); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err = probe.collectStats(ctx)
	if err == nil || time.Since(start) > time.Second {
		t.Fatal("query not bounded", err, time.Since(start))
	}
}
