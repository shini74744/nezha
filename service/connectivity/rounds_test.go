package connectivity

import (
	"context"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func TestFiveMeasuredRoundsPublishEveryPartialAverage(t *testing.T) {
	m := NewManager()
	require.Equal(t, 5, m.rounds)
	require.Equal(t, 2, WarmupRounds)
	selected := Targets()[:1]
	gate := make(chan float64)
	defer close(gate)
	_, err := m.Start("progress", func(ctx context.Context, _ Target) Sample {
		select {
		case v := <-gate:
			return Sample{Status: "ok", DelayMS: &v}
		case <-ctx.Done():
			return Sample{Status: "timeout"}
		}
	}, selected)
	require.NoError(t, err)
	for i, v := range []float64{900, 700, 10, 20, 30, 40, 50} {
		gate <- v
		count := i - 1
		if count < 0 {
			count = 0
		}
		if count == 0 {
			require.Empty(t, m.Get("progress", selected).Results[0].Samples)
			continue
		}
		require.Eventually(t, func() bool { return len(m.Get("progress", selected).Results[0].Samples) == count }, time.Second, time.Millisecond)
		row := m.Get("progress", selected).Results[0]
		require.InDelta(t, float64(count+1)*5, *row.DelayMS, 0.0001)
	}
}
func TestSingleRetestUpgradesLegacyRoundMetadataWithoutRewritingOtherRows(t *testing.T) {
	m := NewManager()
	selected := Targets()[:2]
	s := empty(3, selected)
	s.State = "complete"
	s.FinishedAt = time.Now().UnixMilli()
	for i := range s.Results {
		s.Results[i].Samples = []Sample{{Status: "ok"}, {Status: "ok"}, {Status: "ok"}}
		s.Results[i].Status = "ok"
		s.Results[i].Phase = "complete"
	}
	m.Restore("legacy", s)
	require.Equal(t, 3, m.Get("legacy", selected).Rounds)
	_, err := m.StartImmediate("legacy", selected[0].ID, func(context.Context, Target) Sample { return Sample{Status: "ok"} }, selected)
	require.NoError(t, err)
	require.Eventually(t, func() bool { return m.Get("legacy", selected).State == "complete" }, time.Second, time.Millisecond)
	got := m.Get("legacy", selected)
	require.Equal(t, 5, got.Rounds)
	require.Len(t, got.Results[0].Samples, 5)
	require.Equal(t, s.Results[1], got.Results[1])
	require.Len(t, s.Results[0].Samples, 3)
}
