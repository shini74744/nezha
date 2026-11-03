package monitor

import (
	"context"
	"github.com/nezhahq/agent/pkg/monitor/nic"
	"reflect"
	"testing"
	"time"
)

func TestPerNICCountersIdentityIndependentOfOtherNICs(t *testing.T) {
	saved := captureMonitorTestState()
	oldNow := networkNow
	t.Cleanup(func() { saved.restore(); networkNow = oldNow })
	networkSample = nic.Sample{}
	networkInterfaceSpeeds = nil
	networkCounterEpoch = ""
	now := time.Unix(1000, 0)
	networkNow = func() time.Time { return now }
	value := nic.Sample{In: 100, Out: 200, Interfaces: map[string]nic.Counter{"ens18": {Index: 2, In: 100, Out: 200}}}
	nicStateProbe = func(context.Context) (nic.Sample, error) {
		copy := value
		copy.Interfaces = map[string]nic.Counter{}
		for name, n := range value.Interfaces {
			copy.Interfaces[name] = n
		}
		return copy, nil
	}
	TrackNetworkSpeed(nil)
	first := networkInterfaceSpeeds[0]
	homeTrue(t, first.CountersAvailable)
	homeFalse(t, first.Available)
	homeEqual(t, uint64(100), first.InTransfer)
	homeNotEmpty(t, first.CounterEpoch)
	now = now.Add(time.Second)
	value = nic.Sample{In: 1010, Out: 2020, Interfaces: map[string]nic.Counter{"ens18": {Index: 2, In: 110, Out: 220}, "wg0": {Index: 3, In: 900, Out: 1800}}}
	TrackNetworkSpeed(nil)
	row := networkInterfaceSpeeds[0]
	homeEqual(t, first.CounterEpoch, row.CounterEpoch)
	homeFalse(t, row.Available)
	homeEqual(t, uint64(110), row.InTransfer)
	now = now.Add(time.Second)
	value.Interfaces["ens18"] = nic.Counter{Index: 8, In: 1000, Out: 2000}
	TrackNetworkSpeed(nil)
	homeNotEqual(t, first.CounterEpoch, networkInterfaceSpeeds[0].CounterEpoch)
	homeFalse(t, networkInterfaceSpeeds[0].Available)
	now = now.Add(time.Second)
	value.Interfaces["ens18"] = nic.Counter{Index: 8, In: 1, Out: 2}
	epoch := networkInterfaceSpeeds[0].CounterEpoch
	TrackNetworkSpeed(nil)
	homeNotEqual(t, epoch, networkInterfaceSpeeds[0].CounterEpoch)
}

func homeEqual(t *testing.T, a, b any) {
	t.Helper()
	if !reflect.DeepEqual(a, b) {
		t.Fatalf("expected %v, got %v", a, b)
	}
}
func homeNotEqual(t *testing.T, a, b any) {
	t.Helper()
	if reflect.DeepEqual(a, b) {
		t.Fatalf("expected distinct identities: %v", a)
	}
}
func homeTrue(t *testing.T, v bool) {
	t.Helper()
	if !v {
		t.Fatal("expected true")
	}
}
func homeFalse(t *testing.T, v bool) {
	t.Helper()
	if v {
		t.Fatal("expected false")
	}
}
func homeNotEmpty(t *testing.T, v string) {
	t.Helper()
	if v == "" {
		t.Fatal("missing epoch")
	}
}
