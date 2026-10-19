//go:build !linux && !windows && !(darwin && arm64)

package gpu

import (
	"context"

	"github.com/nezhahq/agent/pkg/monitor/gpu/vendor"
)

// Other platforms keep their existing utilization-only collectors; GetStat falls
// back to utilization-only.
func detailedStat(_ context.Context) ([]vendor.GPUStat, bool, error) {
	return nil, false, nil
}
