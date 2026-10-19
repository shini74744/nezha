//go:build linux

package gpu

import (
	"bytes"
	"context"
	"errors"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/nezhahq/agent/model"
	"github.com/nezhahq/agent/pkg/monitor/gpu/nvidiasnapshot"
	"github.com/nezhahq/agent/pkg/monitor/gpu/vendor"
)

var linuxNvidia = nvidiasnapshot.New(queryLinuxNvidia)
var linuxDRMRoot = func() string {
	root := os.Getenv("HOST_SYS")
	if root == "" {
		root = "/sys"
	}
	return filepath.Join(root, "class/drm")
}
var linuxIntelUsage = func(ctx context.Context, device string) (float64, error) {
	probe := &vendor.IntelGPUTop{BinPath: "/usr/bin/intel_gpu_top", Device: device}
	if err := probe.StartContext(ctx); err != nil {
		return 0, err
	}
	values, err := probe.GatherUsage()
	if err != nil {
		return 0, err
	}
	if len(values) != 1 {
		return 0, errors.New("missing selected Intel GPU")
	}
	return values[0], nil
}
var drmCardName = regexp.MustCompile("^card[0-9]+$")
var linuxPCIID = regexp.MustCompile("^[0-9a-fA-F]{4}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}\\.[0-7]$")

type linuxCard struct{ path, node, vendor, label string }

func smallFile(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, 4097))
	if err != nil || len(raw) > 4096 {
		return ""
	}
	return strings.TrimSpace(string(raw))
}
func linuxCards() []linuxCard {
	entries, _ := os.ReadDir(linuxDRMRoot())
	var out []linuxCard
	seen := map[string]bool{}
	for _, e := range entries {
		if !drmCardName.MatchString(e.Name()) {
			continue
		}
		path := filepath.Join(linuxDRMRoot(), e.Name(), "device")
		id := ""
		for _, line := range strings.Split(smallFile(filepath.Join(path, "uevent")), "\n") {
			if value, ok := strings.CutPrefix(line, "PCI_SLOT_NAME="); ok && linuxPCIID.MatchString(value) {
				id = strings.ToUpper(value)
			}
		}
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		vend := strings.ToLower(smallFile(filepath.Join(path, "vendor")))
		brand := map[string]string{"0x1002": "AMD GPU", "0x8086": "Intel GPU", "0x10de": "NVIDIA GPU"}[vend]
		if brand == "" {
			continue
		}
		name := smallFile(filepath.Join(path, "product_name"))
		if name == "" || len(name) > 256 || strings.IndexFunc(name, func(r rune) bool { return r < 32 || r == 127 }) >= 0 {
			name = brand
		}
		out = append(out, linuxCard{path: path, node: filepath.Join("/dev/dri", e.Name()), vendor: vend, label: name + " [" + id + "]"})
		if len(out) >= 128 {
			break
		}
	}
	return out
}
func linuxNumber(path string, max float64) (float64, bool) {
	n, err := strconv.ParseFloat(smallFile(path), 64)
	return n, err == nil && !math.IsNaN(n) && !math.IsInf(n, 0) && n >= 0 && n <= max
}
func linuxMemory(path string) (uint64, uint64) {
	used, e1 := strconv.ParseUint(smallFile(filepath.Join(path, "mem_info_vram_used")), 10, 64)
	total, e2 := strconv.ParseUint(smallFile(filepath.Join(path, "mem_info_vram_total")), 10, 64)
	if e1 != nil || e2 != nil || total < 1<<20 || total > 1<<50 || used > total {
		return 0, 0
	}
	return used >> 20, total >> 20
}
func detailedStat(parent context.Context) ([]vendor.GPUStat, bool, error) {
	ctx, cancel := context.WithTimeout(parent, 3*time.Second)
	defer cancel()
	var out []vendor.GPUStat
	samples, _ := linuxNvidia.Get(ctx)
	for _, s := range samples {
		if s.UtilizationOK {
			out = append(out, vendor.GPUStat{Name: s.Label(), Utilization: s.Utilization, MemoryUsed: s.MemoryUsed, MemoryTotal: s.MemoryTotal})
		}
	}
	cards := linuxCards()
	for _, card := range cards {
		if ctx.Err() != nil {
			break
		}
		// NVIDIA is queried once above, including devices without a DRM display node.
		if card.vendor == "0x10de" {
			continue
		}
		usage, ok := linuxNumber(filepath.Join(card.path, "gpu_busy_percent"), 100)
		if !ok && card.vendor == "0x8086" {
			var err error
			usage, err = linuxIntelUsage(ctx, card.node)
			ok = err == nil && !math.IsNaN(usage) && !math.IsInf(usage, 0) && usage >= 0 && usage <= 100
		}
		if !ok {
			continue
		}
		stat := vendor.GPUStat{Name: card.label, Utilization: usage}
		if card.vendor == "0x1002" {
			stat.MemoryUsed, stat.MemoryTotal = linuxMemory(card.path)
		}
		out = append(out, stat)
	}
	slices.SortFunc(out, func(a, b vendor.GPUStat) int { return strings.Compare(a.Name, b.Name) })
	if len(out) > 0 || len(cards) > 0 || vendorType == vendorNVIDIA {
		return out, true, nil
	}
	// Preserve the old ROCm/Intel path where the kernel exposes no PCI DRM nodes.
	return nil, false, nil
}

// Temperature collection remains controlled by the temperature switch; no
// GPU load query or Intel subprocess is needed to read AMD's on-die sensor.
func GetCoreTemperatures(ctx context.Context) []model.SensorTemperature {
	var out []model.SensorTemperature
	samples, _ := linuxNvidia.Get(ctx)
	for _, s := range samples {
		if s.TemperatureOK {
			out = append(out, model.SensorTemperature{Name: nvidiasnapshot.TemperaturePrefix + s.Label(), Temperature: s.CoreTemperature})
		}
	}
	for _, card := range linuxCards() {
		if ctx.Err() != nil {
			break
		}
		if card.vendor != "0x1002" {
			continue
		}
		monitors, _ := filepath.Glob(filepath.Join(card.path, "hwmon", "hwmon*"))
		for _, dir := range monitors {
			if smallFile(filepath.Join(dir, "name")) != "amdgpu" {
				continue
			}
			if n, ok := linuxNumber(filepath.Join(dir, "temp1_input"), 150000); ok && n > 0 {
				out = append(out, model.SensorTemperature{Name: nvidiasnapshot.TemperaturePrefix + card.label, Temperature: n / 1000})
				break
			}
		}
	}
	return out
}

type linuxGPUOutput struct{ bytes.Buffer }

func (b *linuxGPUOutput) Write(p []byte) (int, error) {
	if b.Len()+len(p) > nvidiasnapshot.MaxOutput {
		return 0, errors.New("NVIDIA output exceeds limit")
	}
	return b.Buffer.Write(p)
}
func queryLinuxNvidia(parent context.Context) ([]byte, error) {
	path, err := exec.LookPath("nvidia-smi")
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(parent, 2*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, path, nvidiasnapshot.Query, "--format=csv,noheader,nounits")
	cmd.WaitDelay = 100 * time.Millisecond
	var out linuxGPUOutput
	cmd.Stdout = &out
	cmd.Stderr = io.Discard
	if err := cmd.Run(); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}
