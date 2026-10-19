//go:build windows

package temperature

import (
	"context"
	"github.com/nezhahq/agent/model"
	"github.com/nezhahq/agent/pkg/monitor/gpu"
)

func platformTemperatures(ctx context.Context) []model.SensorTemperature {
	return gpu.GetCoreTemperatures(ctx)
}
