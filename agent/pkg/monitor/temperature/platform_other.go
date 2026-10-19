//go:build !windows && !linux && !freebsd

package temperature

import (
	"context"
	"github.com/nezhahq/agent/model"
)

func platformTemperatures(context.Context) []model.SensorTemperature { return nil }
