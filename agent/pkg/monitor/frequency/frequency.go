// Package frequency reads clocks without changing power policy or hardware settings.
package frequency

import (
	"context"
	"math"
)

type Reading struct {
	MHz  float64
	Kind string
}

func valid(v float64) bool { return v > 0 && v <= 100000 && !math.IsNaN(v) && !math.IsInf(v, 0) }
func average(values []float64, kind string) Reading {
	var sum float64
	var n int
	for _, v := range values {
		if valid(v) {
			sum += v
			n++
		}
	}
	if n == 0 {
		return Reading{}
	}
	return Reading{sum / float64(n), kind}
}
func Get(ctx context.Context) Reading {
	if ctx.Err() != nil {
		return Reading{}
	}
	r := read(ctx)
	if !valid(r.MHz) || ctx.Err() != nil {
		return Reading{}
	}
	return r
}
