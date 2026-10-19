package frequency

import (
	"bufio"
	"context"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

func mountedPath(env, fallback string, parts ...string) string {
	root := os.Getenv(env)
	if root == "" {
		root = fallback
	}
	return filepath.Join(append([]string{root}, parts...)...)
}

var sysCPU = mountedPath("HOST_SYS", "/sys", "devices", "system", "cpu")
var procCPU = mountedPath("HOST_PROC", "/proc", "cpuinfo")

func read(ctx context.Context) Reading {
	// cpuinfo_cur_freq is hardware sampled; scaling_cur_freq is a driver-reported request.
	for _, source := range []struct{ file, kind string }{{"cpuinfo_cur_freq", "current"}, {"scaling_cur_freq", "reported"}} {
		paths, _ := filepath.Glob(filepath.Join(sysCPU, "cpu[0-9]*", "cpufreq", source.file))
		var values []float64
		for i, path := range paths {
			if i >= 4096 || ctx.Err() != nil {
				break
			}
			f, e := os.Open(path)
			if e != nil {
				continue
			}
			data, e := io.ReadAll(io.LimitReader(f, 64))
			f.Close()
			if e != nil {
				continue
			}
			n, e := strconv.ParseFloat(strings.TrimSpace(string(data)), 64)
			if e == nil {
				values = append(values, n/1000)
			}
		}
		if r := average(values, source.kind); r.MHz > 0 {
			return r
		}
	}
	f, e := os.Open(procCPU)
	if e != nil {
		return Reading{}
	}
	defer f.Close()
	return parseCPUInfo(ctx, io.LimitReader(f, 4<<20))
}
func parseCPUInfo(ctx context.Context, r io.Reader) Reading {
	scan := bufio.NewScanner(r)
	var values []float64
	for scan.Scan() {
		if ctx.Err() != nil {
			return Reading{}
		}
		key, value, ok := strings.Cut(scan.Text(), ":")
		if !ok || strings.TrimSpace(key) != "cpu MHz" {
			continue
		}
		v, e := strconv.ParseFloat(strings.TrimSpace(value), 64)
		if e == nil {
			values = append(values, v)
		}
	}
	return average(values, "reported")
}
