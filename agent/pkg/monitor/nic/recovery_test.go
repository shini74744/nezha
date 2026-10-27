package nic

import (
	"testing"
	"time"
)

func TestSelectionRecoveryRequiresConfirmedDisappearance(t *testing.T) {
	start := time.Unix(1000, 0)
	allow := map[string]bool{"eth0": true, "eth1": true, "ppp0": false}
	var detector SelectionRecovery
	for i, seconds := range []int{0, 10, 20, 29, 30} {
		got := detector.Observe(allow, []string{"lo", "eth1", "renamed0"}, true, start.Add(time.Duration(seconds)*time.Second))
		if got != (i == 4) {
			t.Fatalf("after %d seconds: %v", seconds, got)
		}
	}
}
func TestSelectionRecoveryDoesNotResetExistingOrUnselectedNICs(t *testing.T) {
	cases := []struct {
		name      string
		allow     map[string]bool
		names     []string
		available bool
	}{
		{"default", nil, []string{"lo", "eth1"}, true},
		{"all unchecked", map[string]bool{"eth0": false}, []string{"lo", "eth1"}, true},
		{"unselected missing", map[string]bool{"eth0": true, "ppp0": false}, []string{"lo", "eth0"}, true},
		{"present even if disconnected", map[string]bool{"eth0": true}, []string{"lo", "eth0"}, true},
		{"enumeration failed", map[string]bool{"eth0": true}, []string{"lo"}, false},
		{"empty enumeration", map[string]bool{"eth0": true}, nil, true},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			var d SelectionRecovery
			for n := 0; n < 10; n++ {
				if d.Observe(tt.allow, tt.names, tt.available, time.Unix(int64(n*10), 0)) {
					t.Fatal("unexpected reset")
				}
			}
		})
	}
}
func TestSelectionRecoveryRestartsConfirmationAfterTransientFailure(t *testing.T) {
	for _, interruption := range []string{"returns", "error", "new selection", "different missing", "clock backwards"} {
		t.Run(interruption, func(t *testing.T) {
			d := SelectionRecovery{}
			a := map[string]bool{"eth0": true, "eth1": true}
			missing := []string{"lo", "eth1"}
			d.Observe(a, missing, true, time.Unix(100, 0))
			d.Observe(a, missing, true, time.Unix(110, 0))
			switch interruption {
			case "returns":
				d.Observe(a, []string{"eth0", "eth1"}, true, time.Unix(120, 0))
			case "error":
				d.Observe(a, nil, false, time.Unix(120, 0))
			case "new selection":
				d.Observe(map[string]bool{"eth2": true}, missing, true, time.Unix(120, 0))
			case "different missing":
				d.Observe(a, []string{"lo", "eth0"}, true, time.Unix(120, 0))
			case "clock backwards":
				d.Observe(a, missing, true, time.Unix(90, 0))
				if d.Observe(a, missing, true, time.Unix(100, 0)) {
					t.Fatal("clock jump reset")
				}
				return
			}
			if d.Observe(a, missing, true, time.Unix(130, 0)) {
				t.Fatal("transient failure was counted")
			}
			if d.Observe(a, missing, true, time.Unix(140, 0)) {
				t.Fatal("confirmation too soon")
			}
			if !d.Observe(a, missing, true, time.Unix(160, 0)) {
				t.Fatal("confirmed disappearance ignored")
			}
		})
	}
}
