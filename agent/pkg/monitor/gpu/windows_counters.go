package gpu

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"

	"github.com/nezhahq/agent/pkg/monitor/gpu/vendor"
)

type windowsAdapter struct {
	ID, Name          string
	Dedicated, Shared uint64
}

func (a windowsAdapter) label() string { return a.Name + " [" + a.ID + "]" }

type windowsCounterSample struct {
	Name  string
	Value float64
}

var counterLUID = regexp.MustCompile(`(?i)luid_0x([0-9a-f]{1,8})_0x([0-9a-f]{1,8})_phys_[0-9]+(?:_eng_([0-9]+)_|$)`)

func parseCounterIdentity(name string) (string, string, bool) {
	parts := counterLUID.FindStringSubmatch(name)
	if parts == nil {
		return "", "", false
	}
	hi, e1 := strconv.ParseUint(parts[1], 16, 32)
	lo, e2 := strconv.ParseUint(parts[2], 16, 32)
	return fmt.Sprintf("%08X:%08X", hi, lo), parts[3], e1 == nil && e2 == nil
}
func finiteCounter(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) && v >= 0 }
func windowsGPUStats(adapters []windowsAdapter, counters map[string][]windowsCounterSample) []vendor.GPUStat {
	if _, ok := counters["util"]; !ok {
		return nil
	}
	engines := map[string]map[string]float64{}
	for _, c := range counters["util"] {
		id, engine, ok := parseCounterIdentity(c.Name)
		if !ok || engine == "" || !finiteCounter(c.Value) {
			continue
		}
		if engines[id] == nil {
			engines[id] = map[string]float64{}
		}
		engines[id][engine] += c.Value
	}
	memory := func(key string) map[string]float64 {
		out := map[string]float64{}
		for _, c := range counters[key] {
			id, _, ok := parseCounterIdentity(c.Name)
			if ok && finiteCounter(c.Value) {
				out[id] += c.Value
			}
		}
		return out
	}
	dedicated, shared := memory("dedicated"), memory("shared")
	var out []vendor.GPUStat
	for _, a := range adapters {
		// A hardware adapter must actually appear in a counter set. A vanished
		// device or inaccessible counter must not become a fabricated idle sample.
		_, engineOK := engines[a.ID]
		d, dOK := dedicated[a.ID]
		s, sOK := shared[a.ID]
		if !engineOK && !dOK && !sOK {
			continue
		}
		g := vendor.GPUStat{Name: a.label()}
		for _, v := range engines[a.ID] {
			g.Utilization = math.Max(g.Utilization, math.Min(v, 100))
		}
		if dOK && a.Dedicated > 0 && d <= float64(a.Dedicated) {
			g.MemoryUsed = uint64(d) / (1 << 20)
			g.MemoryTotal = a.Dedicated / (1 << 20)
		}
		if sOK && a.Shared > 0 && s <= float64(a.Shared) {
			g.SharedMemoryUsed = uint64(s) / (1 << 20)
			g.SharedMemoryTotal = a.Shared / (1 << 20)
		}
		out = append(out, g)
	}
	return out
}

// Model-name matching is used only if it is unambiguous on both sides.
// Identical NVIDIA cards keep PCI-qualified temperature names, never a guessed
// association to an Intel GPU or a same-model sibling.
func adapterLabelForNvidia(name string, adapters []windowsAdapter, nvidiaNames []string) string {
	count := 0
	for _, n := range nvidiaNames {
		if strings.EqualFold(n, name) {
			count++
		}
	}
	if count != 1 {
		return ""
	}
	label := ""
	for _, a := range adapters {
		if strings.EqualFold(a.Name, name) {
			if label != "" {
				return ""
			}
			label = a.label()
		}
	}
	return label
}
