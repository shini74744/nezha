// Package nvidiasnapshot parses the read-only NVIDIA query used on Windows and Linux.
// It does not install drivers, change GPU settings, or run a shell.
package nvidiasnapshot

import (
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

const MaxOutput = 64 * 1024
const Query = "--query-gpu=pci.bus_id,name,utilization.gpu,memory.used,memory.total,temperature.gpu"
const TemperaturePrefix = "GPU Core / "

type Sample struct {
	ID, Name                string
	Utilization             float64
	UtilizationOK           bool
	MemoryUsed, MemoryTotal uint64
	CoreTemperature         float64
	TemperatureOK           bool
}

func (s Sample) Label() string { return s.Name + " [" + s.ID + "]" }

var busID = regexp.MustCompile(`^[0-9A-Fa-f]{4,8}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}\.[0-7]$`)

func number(raw string, max float64) (float64, bool) {
	n, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	return n, err == nil && !math.IsNaN(n) && !math.IsInf(n, 0) && n >= 0 && n <= max
}

func Parse(raw []byte) ([]Sample, error) {
	if len(raw) > MaxOutput {
		return nil, errors.New("NVIDIA output exceeds limit")
	}
	reader := csv.NewReader(strings.NewReader(string(raw)))
	reader.FieldsPerRecord = 6
	reader.TrimLeadingSpace = true
	var out []Sample
	seen := make(map[string]bool)
	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("NVIDIA CSV: %w", err)
		}
		id, name := strings.ToUpper(strings.TrimSpace(row[0])), strings.TrimSpace(row[1])
		if !busID.MatchString(id) || name == "" || len(name) > 256 || strings.IndexFunc(name, func(r rune) bool { return r < 32 || r == 127 }) >= 0 {
			return nil, errors.New("invalid NVIDIA device identity")
		}
		if seen[id] {
			return nil, errors.New("duplicate NVIDIA device identity")
		}
		seen[id] = true
		s := Sample{ID: id, Name: name}
		s.Utilization, s.UtilizationOK = number(row[2], 100)
		used, usedOK := number(row[3], 1<<30)
		total, totalOK := number(row[4], 1<<30)
		if usedOK && totalOK && total > 0 && used <= total && math.Trunc(used) == used && math.Trunc(total) == total {
			s.MemoryUsed, s.MemoryTotal = uint64(used), uint64(total)
		}
		s.CoreTemperature, s.TemperatureOK = number(row[5], 150)
		s.TemperatureOK = s.TemperatureOK && s.CoreTemperature > 0
		out = append(out, s)
		if len(out) > 128 {
			return nil, errors.New("too many NVIDIA devices")
		}
	}
	if len(out) == 0 {
		return nil, errors.New("no NVIDIA samples")
	}
	slices.SortFunc(out, func(a, b Sample) int { return strings.Compare(a.ID, b.ID) })
	return out, nil
}

// Cache shares a single bounded query between GPU and temperature collection.
// Failures replace, never reuse, the previous successful readings. A short
// negative cache avoids repeated subprocesses while allowing driver recovery.
type Cache struct {
	mu      sync.Mutex
	run     func(context.Context) ([]byte, error)
	now     func() time.Time
	until   time.Time
	samples []Sample
	err     error
}

func New(run func(context.Context) ([]byte, error)) *Cache { return &Cache{run: run, now: time.Now} }
func (c *Cache) Get(ctx context.Context) ([]Sample, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if c.now().Before(c.until) {
		return slices.Clone(c.samples), c.err
	}
	raw, err := c.run(ctx)
	var samples []Sample
	if err == nil {
		samples, err = Parse(raw)
	}
	c.samples, c.err = samples, err
	ttl := 3 * time.Second
	if err != nil {
		ttl = 5 * time.Second
	}
	c.until = c.now().Add(ttl)
	return slices.Clone(c.samples), c.err
}
