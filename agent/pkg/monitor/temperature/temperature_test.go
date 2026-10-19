package temperature

import (
	"context"
	"errors"
	"github.com/nezhahq/agent/model"
	"github.com/shirou/gopsutil/v4/sensors"
	"testing"
)

func TestGPUCoreIndependentOfACPIFailure(t *testing.T) {
	oldSensor, oldExtra := sensorTemperatures, extraTemperatures
	defer func() { sensorTemperatures, extraTemperatures = oldSensor, oldExtra }()
	sensorTemperatures = func(context.Context) ([]sensors.TemperatureStat, error) { return nil, errors.New("ACPI unavailable") }
	extraTemperatures = func(context.Context) []model.SensorTemperature {
		return []model.SensorTemperature{{Name: "GPU Core / RTX [1]", Temperature: 45}}
	}
	got, e := GetState(context.Background())
	if e != nil || len(got) != 1 || got[0].Temperature != 45 {
		t.Fatal(got, e)
	}
	extraTemperatures = func(context.Context) []model.SensorTemperature { return nil }
	got, _ = GetState(context.Background())
	if len(got) > 0 {
		t.Fatal("stale GPU temperature", got)
	}
}
func TestACPIRemainsNamedACPI(t *testing.T) {
	oldSensor, oldExtra := sensorTemperatures, extraTemperatures
	defer func() { sensorTemperatures, extraTemperatures = oldSensor, oldExtra }()
	extraTemperatures = func(context.Context) []model.SensorTemperature { return nil }
	sensorTemperatures = func(context.Context) ([]sensors.TemperatureStat, error) {
		return []sensors.TemperatureStat{{SensorKey: "ACPI ThermalZone", Temperature: 30}, {SensorKey: "bad", Temperature: 999}}, nil
	}
	got, e := GetState(context.Background())
	if e != nil || len(got) != 1 || got[0].Name != "ACPI ThermalZone" {
		t.Fatal(got, e)
	}
}
