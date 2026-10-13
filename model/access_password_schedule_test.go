package model

import (
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func TestAccessPasswordScheduleBoundaries(t *testing.T) {
	for _, tc := range []struct {
		start, end, at string
		want           bool
	}{
		{"08:00", "23:00", "07:59:59", false}, {"08:00", "23:00", "08:00:00", true},
		{"08:00", "23:00", "22:59:59", true}, {"08:00", "23:00", "23:00:00", false},
		{"22:00", "07:00", "21:59:59", false}, {"22:00", "07:00", "22:00:00", true},
		{"22:00", "07:00", "23:59:59", true}, {"22:00", "07:00", "00:00:00", true},
		{"22:00", "07:00", "06:59:59", true}, {"22:00", "07:00", "07:00:00", false},
		{"00:00", "00:01", "00:00:59", true}, {"00:00", "00:01", "00:01:00", false},
		{"23:59", "00:00", "23:59:59", true}, {"23:59", "00:00", "00:00:00", false},
	} {
		t.Run(tc.start+"-"+tc.end+"@"+tc.at, func(t *testing.T) {
			s := AccessPasswordSchedule{Enabled: true, Start: tc.start, End: tc.end}
			require.NoError(t, s.Validate())
			now, err := time.Parse(time.RFC3339, "2026-10-13T"+tc.at+"+08:00")
			require.NoError(t, err)
			for _, zone := range []*time.Location{time.UTC, time.FixedZone("west", -7*3600), accessPasswordZone} {
				require.Equal(t, tc.want, s.ActiveAt(now.In(zone)))
			}
		})
	}
	require.True(t, (AccessPasswordSchedule{}).ActiveAt(time.Now()))
	require.Equal(t, AccessPasswordSchedule{Start: "08:00", End: "23:00"}, (AccessPasswordSchedule{}).WithDefaults())
	for _, s := range []AccessPasswordSchedule{
		{true, "", ""}, {true, "08:00", "08:00"}, {true, "24:00", "12:00"},
		{true, "8:00", "23:00"}, {true, "08:60", "23:00"}, {true, "-1:00", "23:00"},
	} {
		require.Error(t, s.Validate())
		require.True(t, s.ActiveAt(time.Now()), "invalid manual config must fail closed")
	}
}
