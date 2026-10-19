package temperature

import (
	"github.com/shirou/gopsutil/v4/sensors"
	"math"
	"testing"
)

func TestAppleIntegratedCoreTemperature(t *testing.T) {
	temps := []sensors.TemperatureStat{{SensorKey: "GPU MTR Temp Sensor0", Temperature: 42}, {SensorKey: "GPU MTR Temp Sensor1", Temperature: 46}, {SensorKey: "GPU MTR Temp Sensor2", Temperature: math.NaN()}, {SensorKey: "GPU Proximity", Temperature: 99}, {SensorKey: "pACC MTR Temp Sensor0", Temperature: 90}}
	got := appleIntegratedTemperature(temps)
	if len(got) != 1 || got[0].Temperature != 46 || got[0].Name != "GPU Core / Apple GPU (integrated)" {
		t.Fatal(got)
	}
	if len(appleIntegratedTemperature(nil)) != 0 {
		t.Fatal("missing should be hidden")
	}
}
