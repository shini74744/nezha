package gpu

import (
	"context"
	"github.com/nezhahq/agent/pkg/monitor/gpu/vendor"
	"math"
)

// Apple Silicon has one integrated GPU. Unified system RAM is not dedicated VRAM.
func detailedStat(ctx context.Context) ([]vendor.GPUStat, bool, error) {
	values, err := GetState(ctx)
	if err != nil || len(values) != 1 || math.IsNaN(values[0]) || math.IsInf(values[0], 0) || values[0] < 0 || values[0] > 100 {
		return nil, true, nil
	}
	return []vendor.GPUStat{{Name: vendor.AppleIntegratedName, Utilization: values[0]}}, true, nil
}
