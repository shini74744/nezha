package networkinsight

import (
	"encoding/json"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestReturnComparisonKeysBeforeRedaction(t *testing.T) {
	mk := func(target, protocol string) ReturnResult {
		return ReturnResult{ID: "bj-ct", Family: "IPv4", Protocol: protocol, Target: target}
	}
	latest := Snapshot{Routes: []ReturnResult{mk("106.37.68.13", "tcp"), mk("1.1.1.1", "tcp"), mk("", "tcp")}}
	old := Snapshot{Routes: []ReturnResult{mk("106.37.68.13", "tcp"), mk("106.37.68.13", "icmp")}}
	GroupReturnComparisons(&latest, nil, &old)
	require.NotEmpty(t, latest.Routes[0].ComparisonKey)
	require.Equal(t, latest.Routes[0].ComparisonKey, old.Routes[0].ComparisonKey)
	require.NotEqual(t, latest.Routes[0].ComparisonKey, latest.Routes[1].ComparisonKey)
	require.NotEqual(t, latest.Routes[0].ComparisonKey, old.Routes[1].ComparisonKey)
	require.Empty(t, latest.Routes[2].ComparisonKey)
	for i := range latest.Routes {
		RedactReturnRoute(&latest.Routes[i])
	}
	raw, err := json.Marshal(latest)
	require.NoError(t, err)
	require.NotContains(t, string(raw), "106.37.68.13")
	require.NotContains(t, string(raw), "1.1.1.1")
	require.Equal(t, old.Routes[0].ComparisonKey, latest.Routes[0].ComparisonKey)
	latest.Routes[2].ComparisonKey = "stale"
	GroupReturnComparisons(&latest)
	require.Empty(t, latest.Routes[2].ComparisonKey)
}
func TestReturnComparisonSeparatesFamiliesAndNormalizesIPv6(t *testing.T) {
	s := Snapshot{Routes: []ReturnResult{
		{ID: "x", Family: "IPv6", Target: "2001:4860:4860::8888", Protocol: "tcp"},
		{ID: "x", Family: "IPv6", Target: "2001:4860:4860:0:0:0:0:8888", Protocol: "tcp"},
		{ID: "y", Family: "IPv6", Target: "2001:4860:4860::8888", Protocol: "tcp"},
		{ID: "x", Family: "IPv4", Target: "1.1.1.1", Protocol: "tcp"},
	}}
	GroupReturnComparisons(&s)
	require.Equal(t, s.Routes[0].ComparisonKey, s.Routes[1].ComparisonKey)
	require.NotEqual(t, s.Routes[0].ComparisonKey, s.Routes[2].ComparisonKey)
	require.NotEqual(t, s.Routes[0].ComparisonKey, s.Routes[3].ComparisonKey)
}
