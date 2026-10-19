package temperature

import (
	"context"
	"github.com/nezhahq/agent/model"
	"golang.org/x/sys/unix"
)

func platformTemperatures(ctx context.Context) []model.SensorTemperature {
	return readBSDTemperatures(ctx, unix.SysctlUint32)
}
