package vendor

import (
	"bufio"
	"context"
	"errors"
	"io"
	"math"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jaypipes/ghw"
)

const (
	intelVendorID         = "0x8086"
	intelGPUStatsInterval = "1000" // in milliseconds
)

// Cache for Intel GPU detection and model info (these don't change at runtime)
var (
	intelGPUDetected     bool
	intelGPUDetectedOnce sync.Once
	intelGPUModels       []string
	intelGPUModelsOnce   sync.Once
	intelGPUTopPath      string
	intelGPUTopPathOnce  sync.Once
)

type IntelGPUTop struct {
	BinPath string
	Device  string // Optional DRM node; selects exactly this GPU on mixed systems.
	usage   float64
}

// IsAvailable checks if the intel_gpu_top tool is present and usable.
// This is used for vendor detection and is much faster than calling Start().
func (igt *IntelGPUTop) IsAvailable() bool {
	intelGPUDetectedOnce.Do(func() {
		igt.hasIntelGPUTopTool()
		// If tool exists, we assume Intel GPU is present and supported
		intelGPUDetected = intelGPUTopPath != ""
	})
	return intelGPUDetected
}

// hasIntelGPUTopTool checks if intel_gpu_top binary is available
func (igt *IntelGPUTop) hasIntelGPUTopTool() bool {
	intelGPUTopPathOnce.Do(func() {
		if _, err := os.Stat(igt.BinPath); err == nil {
			intelGPUTopPath = igt.BinPath
			return
		}
		if path, err := exec.LookPath("intel_gpu_top"); err == nil {
			intelGPUTopPath = path
		}
	})
	return intelGPUTopPath != ""
}

func (igt *IntelGPUTop) GatherModel() ([]string, error) {
	// Cache model info since it doesn't change at runtime
	var modelErr error
	intelGPUModelsOnce.Do(func() {
		intelGPUModels, modelErr = igt.gatherModel()
	})
	if modelErr != nil {
		return nil, modelErr
	}
	if len(intelGPUModels) == 0 {
		return nil, errors.New("no Intel GPU model found")
	}
	return intelGPUModels, nil
}

func (igt *IntelGPUTop) GatherUsage() ([]float64, error) {
	if igt.usage < 0 {
		return nil, errors.New("no data collected from intel_gpu_top")
	}
	return []float64{igt.usage}, nil
}

func (igt *IntelGPUTop) Start() error {
	return igt.StartContext(context.Background())
}

func (igt *IntelGPUTop) StartContext(ctx context.Context) error {
	// Use cached detection result
	if !igt.IsAvailable() {
		return errors.New("Intel GPU or intel_gpu_top not available")
	}

	// Use cached binary path
	if intelGPUTopPath != "" {
		igt.BinPath = intelGPUTopPath
	}

	usage, err := igt.collectStats(ctx)
	if err != nil {
		return err
	}
	igt.usage = usage
	return nil
}

// collectStats executes intel_gpu_top in text mode (-l) and parses the output
// This avoids JSON corruption issues that can occur with -J mode
func (igt *IntelGPUTop) collectStats(parent context.Context) (float64, error) {
	ctx, cancel := context.WithTimeout(parent, 2500*time.Millisecond)
	defer cancel()
	// Explicit selection prevents an Intel card from taking another adapter's readings.
	interval := intelGPUStatsInterval
	if igt.Device != "" {
		interval = "250"
	}
	args := []string{"-s", interval, "-l"}
	if igt.Device != "" {
		args = append(args, "-d", "drm:"+igt.Device)
	}
	cmd := exec.CommandContext(ctx, igt.BinPath, args...)
	cmd.WaitDelay = 100 * time.Millisecond

	// Avoid blocking if intel_gpu_top writes to stderr
	cmd.Stderr = io.Discard

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return 0, err
	}

	if err := cmd.Start(); err != nil {
		return 0, err
	}

	// Ensure we always reap the child to avoid zombies
	defer func() {
		_ = stdout.Close()
		if cmd.ProcessState == nil || !cmd.ProcessState.Exited() {
			_ = cmd.Process.Kill()
		}
		_ = cmd.Wait()
	}()

	scanner := bufio.NewScanner(stdout)
	var header1 string
	var engineNames []string
	var preEngineCols int
	var hadDataRow bool
	var skippedFirstDataRow bool
	var maxUsage float64

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		// First header line starts with "Freq"
		if strings.HasPrefix(line, "Freq") {
			header1 = line
			continue
		}

		// Second header line starts with "req"
		if strings.HasPrefix(line, "req") {
			engineNames, preEngineCols = parseIntelHeaders(header1, line)
			continue
		}

		// Skip first data row as it sometimes has erroneous data
		if !skippedFirstDataRow {
			skippedFirstDataRow = true
			continue
		}

		// Data row - parse and get usage
		usage, err := parseIntelDataRow(line, engineNames, preEngineCols)
		if err != nil {
			continue
		}

		if usage > maxUsage {
			maxUsage = usage
		}
		hadDataRow = true

		// We only need one valid data row
		break
	}

	if scanErr := scanner.Err(); scanErr != nil {
		return 0, scanErr
	}

	if !hadDataRow {
		return 0, errors.New("no valid data from intel_gpu_top")
	}

	return maxUsage, nil
}

// parseIntelHeaders parses the header lines to determine column positions
// Header format example:
// Freq MHz  IRQ RC6   Power     RCS/0   BCS/0   VCS/0   VCS/1  VECS/0
// req  act       %     gpu       %       %       %       %       %
func parseIntelHeaders(header1, header2 string) (engineNames []string, preEngineCols int) {
	h1 := strings.Fields(header1)
	h2 := strings.Fields(header2)

	// Collect engine names from header1
	for _, col := range h1 {
		// Strip trailing numbers and slashes (e.g., "RCS/0" -> "RCS")
		key := strings.TrimRightFunc(col, func(r rune) bool {
			return (r >= '0' && r <= '9') || r == '/'
		})

		switch key {
		case "RCS", "BCS", "VCS", "VECS", "CCS":
			engineNames = append(engineNames, key)
		}
	}

	// Calculate pre-engine columns count
	// Each engine has 3 columns in data rows (busy%, sema%, wait%)
	if n := len(engineNames); n > 0 {
		preEngineCols = max(len(h2)-3*n, 0)
	}

	return engineNames, preEngineCols
}

// parseIntelDataRow parses a data row and returns the maximum engine usage
// Data format example:
// 300  100     0 95.29   0.00    0.00   0.00    0.00   0.00    0.00   5.32   0.00    0.00
func parseIntelDataRow(line string, engineNames []string, preEngineCols int) (float64, error) {
	fields := strings.Fields(line)
	if len(fields) == 0 || len(engineNames) == 0 || preEngineCols < 0 {
		return 0, errors.New("missing Intel engine data")
	}

	// Make sure row has enough columns for engines
	// Each engine has 3 columns: busy%, sema%, wait%
	need := preEngineCols + 3*len(engineNames)
	if len(fields) < need {
		return 0, errors.New("insufficient columns in data row")
	}

	var maxBusy float64
	valid := false

	// Parse engine busy percentages
	for k := range engineNames {
		// busy% is at position: preEngineCols + 3*k
		base := preEngineCols + 3*k
		if base < len(fields) {
			if v, err := strconv.ParseFloat(fields[base], 64); err == nil && !math.IsNaN(v) && !math.IsInf(v, 0) && v >= 0 && v <= 100 {
				valid = true
				if v > maxBusy {
					maxBusy = v
				}
			}
		}
	}

	if !valid {
		return 0, errors.New("Intel engine readings unavailable")
	}
	return maxBusy, nil
}

func (igt *IntelGPUTop) gatherModel() ([]string, error) {
	gpu, err := ghw.GPU(ghw.WithDisableWarnings())
	if err != nil {
		return nil, err
	}

	var models []string
	for _, card := range gpu.GraphicsCards {
		if card.DeviceInfo != nil && strings.EqualFold(card.DeviceInfo.Vendor.ID, "8086") {
			models = append(models, card.DeviceInfo.Product.Name)
		}
	}

	if len(models) == 0 {
		return nil, errors.New("no Intel GPU model found")
	}

	return models, nil
}
