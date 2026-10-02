package model

import (
	"math"
	"testing"
)

func TestAlertTotalNetworkSpeedAddsBothDirections(t *testing.T) {
	tests := []struct {
		name     string
		in, out  uint64
		min, max float64
		passed   bool
	}{
		{"download heavy", 100, 10, 0, 50, false},
		{"upload heavy", 10, 100, 0, 150, true},
		{"equal upper bound", 100, 10, 0, 110, true},
		{"below lower bound", 100, 10, 120, 0, false},
		{"sum without uint overflow", math.MaxUint64, math.MaxUint64, 0, float64(math.MaxUint64), false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := &Server{Common: Common{ID: 1}, State: &HostState{NetInSpeed: test.in, NetOutSpeed: test.out}}
			rule := &Rule{Type: "net_all_speed", Cover: RuleCoverAll, Duration: 3, Min: test.min, Max: test.max}
			if got := rule.Snapshot(nil, server, nil); got != test.passed {
				t.Fatalf("Snapshot=%v, want %v", got, test.passed)
			}
		})
	}
}

func TestAlertThresholdRangeValidation(t *testing.T) {
	tests := []struct {
		min, max float64
		valid    bool
	}{
		{0, 0, true}, {0, 80, true}, {10, 0, true}, {10, 80, true},
		{80, 10, false}, {80, 80, false}, {math.NaN(), 80, false}, {0, math.Inf(1), false},
	}
	for _, test := range tests {
		rule := &Rule{Type: "cpu", Cover: RuleCoverAll, Duration: 3, Min: test.min, Max: test.max}
		if got := rule.HasValidThresholdRange(); got != test.valid {
			t.Fatalf("range %v/%v: got %v", test.min, test.max, got)
		}
		alert := &AlertRule{Rules: []*Rule{rule}}
		if got := alert.IsSafeToEvaluate(); got != test.valid {
			t.Fatalf("runtime range %v/%v: got %v", test.min, test.max, got)
		}
	}
}

func TestAlertLegacyDurationCadenceUnchanged(t *testing.T) {
	if AlertSampleIntervalSeconds != 3 {
		t.Fatal("changing cadence requires explicit duration migration")
	}
	for _, kind := range []string{"offline", "tcp_conn_count"} {
		rule := &AlertRule{Rules: []*Rule{{Type: kind, Cover: RuleCoverAll, Duration: 60, Max: 3000}}}
		var points [][]bool
		for n := 1; n <= 60; n++ {
			points = append(points, []bool{false})
			_, passed := rule.Check(points)
			if passed != (n < 60) {
				t.Fatalf("%s: sample %d passed=%v", kind, n, passed)
			}
		}
		if rule.RetentionWindow() != 60 {
			t.Fatal("legacy window changed")
		}
	}
}
