//go:build windows

package gpu

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"

	"github.com/nezhahq/agent/model"
	"github.com/nezhahq/agent/pkg/monitor/gpu/nvidiasnapshot"
	"github.com/nezhahq/agent/pkg/monitor/gpu/vendor"
	"golang.org/x/sys/windows"
)

var windowsNvidia = nvidiasnapshot.New(queryWindowsNvidia)
var windowsGPUFallback = GetState
var windowsAdapterProbe = listWindowsAdapters
var windowsCounterProbe = readWindowsGPUCounters

// Names are supplied with the readings: ghw may enumerate virtual displays
// and Intel adapters in a completely different order. Host.GPU is unchanged.
func detailedStat(ctx context.Context) ([]vendor.GPUStat, bool, error) {
	adapters, adapterErr := windowsAdapterProbe()
	if adapterErr == nil {
		counters, counterErr := windowsCounterProbe(ctx)
		if counterErr == nil {
			if stats := windowsGPUStats(adapters, counters); len(stats) > 0 {
				return stats, true, nil
			}
		}
	}
	samples, err := windowsNvidia.Get(ctx)
	var stats []vendor.GPUStat
	if err == nil {
		names := make([]string, 0, len(samples))
		for _, s := range samples {
			names = append(names, s.Name)
		}
		for _, s := range samples {
			if !s.UtilizationOK {
				continue
			}
			label := adapterLabelForNvidia(s.Name, adapters, names)
			if label == "" {
				label = s.Label()
			}
			stats = append(stats, vendor.GPUStat{Name: label, Utilization: s.Utilization, MemoryUsed: s.MemoryUsed, MemoryTotal: s.MemoryTotal})
		}
	}
	if len(stats) > 0 {
		return stats, true, nil
	}
	util, err := windowsGPUFallback(ctx)
	if err == nil {
		for _, u := range util {
			stats = append(stats, vendor.GPUStat{Name: "Windows GPU (3D aggregate)", Utilization: u})
		}
	}
	// No old memory/temperature and no permanently exhausted probe retry budget
	// after a missing tool, suspended GPU, or transient driver failure.
	return stats, true, nil
}

// This is called only by the existing temperature switch. It works even when
// the GPU utilization switch is off, and does not relabel ACPI as CPU/GPU core.
func GetCoreTemperatures(ctx context.Context) []model.SensorTemperature {
	samples, err := windowsNvidia.Get(ctx)
	if err != nil {
		return nil
	}
	var out []model.SensorTemperature
	adapters, _ := windowsAdapterProbe()
	names := make([]string, 0, len(samples))
	for _, s := range samples {
		names = append(names, s.Name)
	}
	for _, s := range samples {
		label := adapterLabelForNvidia(s.Name, adapters, names)
		if label == "" {
			label = s.Label()
		}
		if s.TemperatureOK {
			out = append(out, model.SensorTemperature{Name: nvidiasnapshot.TemperaturePrefix + label, Temperature: s.CoreTemperature})
		}
	}
	return out
}

func findWindowsNvidiaSMI() (string, error) {
	var paths []string
	if system, err := windows.GetSystemDirectory(); err == nil {
		paths = append(paths, filepath.Join(system, "nvidia-smi.exe"))
	}
	for _, key := range []string{"ProgramW6432", "ProgramFiles"} {
		if dir := os.Getenv(key); filepath.IsAbs(dir) {
			paths = append(paths, filepath.Join(dir, "NVIDIA Corporation", "NVSMI", "nvidia-smi.exe"))
		}
	}
	if path, err := exec.LookPath("nvidia-smi.exe"); err == nil && filepath.IsAbs(path) {
		paths = append(paths, path)
	}
	for _, path := range paths {
		if info, err := os.Stat(path); err == nil && info.Mode().IsRegular() {
			return path, nil
		}
	}
	return "", errors.New("NVIDIA query tool unavailable")
}

type boundedGPUOutput struct{ bytes.Buffer }

func (b *boundedGPUOutput) Write(p []byte) (int, error) {
	if b.Len()+len(p) > nvidiasnapshot.MaxOutput {
		return 0, errors.New("NVIDIA output exceeds limit")
	}
	return b.Buffer.Write(p)
}
func queryWindowsNvidia(parent context.Context) ([]byte, error) {
	path, err := findWindowsNvidiaSMI()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(parent, 2*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, path, nvidiasnapshot.Query, "--format=csv,noheader,nounits")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	cmd.WaitDelay = 100 * time.Millisecond
	var output boundedGPUOutput
	cmd.Stdout = &output
	cmd.Stderr = io.Discard
	if err = cmd.Run(); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}
