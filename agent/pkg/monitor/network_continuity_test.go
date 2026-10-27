package monitor

import (
	"context"
	"errors"
	"github.com/nezhahq/agent/model"
	"github.com/nezhahq/agent/pkg/monitor/nic"
	"testing"
	"time"
)

func TestNetworkSelectionRebasesWithoutInventingTraffic(t *testing.T) {
	saved := captureMonitorTestState()
	oldNow := networkNow
	t.Cleanup(func() { saved.restore(); networkNow = oldNow })
	networkCounterEpoch = ""
	networkSample = nic.Sample{}
	now := time.Unix(1000, 0)
	networkNow = func() time.Time { return now }
	counters := map[string]nic.Counter{"eth0": {Index: 2, In: 100 << 30, Out: 50 << 30}, "eth1": {Index: 3, In: 500 << 30, Out: 250 << 30}}
	nicStateProbe = func(ctx context.Context) (nic.Sample, error) {
		allow, _ := ctx.Value(nic.NICKey).(map[string]bool)
		result := nic.Sample{Interfaces: map[string]nic.Counter{}}
		for name, c := range counters {
			if nic.IsMonitored(name, allow) {
				result.Interfaces[name] = c
				result.In += c.In
				result.Out += c.Out
			}
		}
		return result, nil
	}
	step := func(allow map[string]bool) string {
		now = now.Add(time.Second)
		TrackNetworkSpeed(&model.AgentConfig{NICAllowlist: allow})
		if netInSpeed != 0 || netOutSpeed != 0 {
			t.Fatalf("selection-only change created speed: %d/%d", netInSpeed, netOutSpeed)
		}
		if networkCounterEpoch == "" {
			t.Fatal("missing epoch")
		}
		return networkCounterEpoch
	}
	a := step(map[string]bool{"eth0": true})
	if step(map[string]bool{"eth0": true, "eth1": false}) != a {
		t.Fatal("unchanged effective selection reset epoch")
	}
	b := step(nil)
	if a == b {
		t.Fatal("adding interface must rebase")
	}
	if step(map[string]bool{}) != b {
		t.Fatal("nil and empty defaults differ")
	}
	c := step(map[string]bool{"eth0": false, "eth1": false})
	if c == b {
		t.Fatal("all-off must rebase")
	}
	if step(map[string]bool{"eth0": false}) != c {
		t.Fatal("empty effective set should be stable")
	}
	d := step(map[string]bool{"eth0": true})
	if d == a || d == c {
		t.Fatal("A-B-A or off-on reused epoch")
	}
	// Real traffic resumes immediately after the new baseline.
	x := counters["eth0"]
	x.In += 10
	x.Out += 20
	counters["eth0"] = x
	now = now.Add(time.Second)
	TrackNetworkSpeed(&model.AgentConfig{NICAllowlist: map[string]bool{"eth0": true}})
	if netInSpeed != 10 || netOutSpeed != 20 || networkCounterEpoch != d {
		t.Fatal("real traffic after rebase lost")
	}
	// Failed enumeration must not become an empty selection.
	nicStateProbe = func(context.Context) (nic.Sample, error) { return nic.Sample{}, errors.New("temporarily unavailable") }
	before := netInTransfer
	now = now.Add(time.Second)
	TrackNetworkSpeed(nil)
	if networkCounterEpoch != d || netInTransfer != before {
		t.Fatal("probe failure changed baseline")
	}
}
func TestNetworkCounterResetHiddenByAnotherNICRebases(t *testing.T) {
	saved := captureMonitorTestState()
	oldNow := networkNow
	t.Cleanup(func() { saved.restore(); networkNow = oldNow })
	networkCounterEpoch = ""
	networkSample = nic.Sample{}
	now := time.Unix(2000, 0)
	networkNow = func() time.Time { return now }
	value := nic.Sample{In: 110, Interfaces: map[string]nic.Counter{"a": {Index: 1, In: 100}, "b": {Index: 2, In: 10}}}
	nicStateProbe = func(context.Context) (nic.Sample, error) { return value, nil }
	TrackNetworkSpeed(nil)
	oldEpoch := networkCounterEpoch
	value = nic.Sample{In: 1000, Interfaces: map[string]nic.Counter{"a": {Index: 1, In: 0}, "b": {Index: 2, In: 1000}}}
	now = now.Add(time.Second)
	TrackNetworkSpeed(nil)
	if networkCounterEpoch == oldEpoch || netInSpeed != 0 {
		t.Fatal("hidden per-interface reset created traffic")
	}
	oldEpoch = networkCounterEpoch
	value.Interfaces = map[string]nic.Counter{"a": {Index: 99, In: 0}, "b": {Index: 2, In: 1000}}
	now = now.Add(time.Second)
	TrackNetworkSpeed(nil)
	if networkCounterEpoch == oldEpoch {
		t.Fatal("recreated interface must rebase")
	}
}
