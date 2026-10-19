package temperature

import (
	"github.com/nezhahq/agent/model"
	"github.com/nezhahq/agent/pkg/monitor/gpu/vendor"
	"github.com/shirou/gopsutil/v4/sensors"
	"math"
	"regexp"
)

var appleGPUCore = regexp.MustCompile("^GPU MTR Temp Sensor[0-9]+$")

func appleIntegratedTemperature(temps []sensors.TemperatureStat) []model.SensorTemperature {
	var highest float64
	for _, t := range temps {
		if appleGPUCore.MatchString(t.SensorKey) && t.Temperature > highest && t.Temperature <= 150 && !math.IsNaN(t.Temperature) && !math.IsInf(t.Temperature, 0) {
			highest = t.Temperature
		}
	}
	if highest == 0 {
		return nil
	}
	return []model.SensorTemperature{{Name: "GPU Core / " + vendor.AppleIntegratedName, Temperature: highest}}
}
