package temperature

import (
	"context"
	"fmt"
	"math"
	"runtime"
	"slices"
	"strings"

	"github.com/shirou/gopsutil/v4/sensors"

	"github.com/nezhahq/agent/model"
)

var sensorIgnoreList = []string{
	"PMU tcal", // the calibration sensor on arm macs, value is fixed
	"noname",
}

var sensorTemperatures = sensors.TemperaturesWithContext
var extraTemperatures = platformTemperatures

func GetState(ctx context.Context) ([]model.SensorTemperature, error) {
	extra := extraTemperatures(ctx)
	temperatures, err := sensorTemperatures(ctx)
	if err != nil {
		if _, ok := err.(*sensors.Warnings); !ok && len(extra) == 0 && runtime.GOOS != "windows" && runtime.GOOS != "linux" && runtime.GOOS != "freebsd" {
			return nil, fmt.Errorf("SensorsTemperatures: %v", err)
		}
	}

	tempStat := slices.Clone(extra)
	if runtime.GOOS == "darwin" && runtime.GOARCH == "arm64" {
		tempStat = append(tempStat, appleIntegratedTemperature(temperatures)...)
	}
	for _, t := range temperatures {
		if t.Temperature > 0 && t.Temperature <= 150 && !math.IsNaN(t.Temperature) && !math.IsInf(t.Temperature, 0) && !slices.Contains(sensorIgnoreList, t.SensorKey) {
			tempStat = append(tempStat, model.SensorTemperature{
				Name:        t.SensorKey,
				Temperature: t.Temperature,
			})
		}
	}

	slices.SortFunc(tempStat, func(a, b model.SensorTemperature) int {
		return strings.Compare(a.Name, b.Name)
	})

	return tempStat, nil
}
