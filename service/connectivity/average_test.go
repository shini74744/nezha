package connectivity

import (
	"github.com/stretchr/testify/require"
	"math"
	"testing"
)

func TestAverageLatencyUsesAllValidSamples(t *testing.T) {
	sample := func(status string, n float64) Sample { return Sample{Status: status, DelayMS: &n} }
	r := Result{Samples: []Sample{sample("ok", 10), sample("ok", 20), sample("ok", 120)}}
	summarize(&r)
	require.InDelta(t, 50, *r.DelayMS, 1e-9)
	r = Result{Samples: []Sample{sample("ok", 0), sample("http_error", 100), {Status: "timeout"}, sample("ok", math.NaN()), sample("ok", math.Inf(1)), sample("ok", -10)}}
	summarize(&r)
	require.InDelta(t, 50, *r.DelayMS, 1e-9)
	r.Samples = []Sample{{Status: "timeout"}}
	summarize(&r)
	require.Nil(t, r.DelayMS)
}
