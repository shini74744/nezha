package frequency

import (
	"context"
	"math"
	"testing"
)

func TestAverageAndValidation(t *testing.T) {
	r := average([]float64{1000, 3000, 0, -1, math.NaN(), math.Inf(1), 200000}, "reported")
	if r.MHz != 2000 || r.Kind != "reported" {
		t.Fatal(r)
	}
	if average(nil, "current") != (Reading{}) {
		t.Fatal("missing is not zero frequency")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if Get(ctx) != (Reading{}) {
		t.Fatal("cancelled read")
	}
}
