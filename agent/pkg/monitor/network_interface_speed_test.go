package monitor

import (
	"context"
	"errors"
	"github.com/nezhahq/agent/model"
	"github.com/nezhahq/agent/pkg/monitor/nic"
	"reflect"
	"testing"
	"time"
)

func TestInterfaceRatesMatchSelectedTotalsAndHandleChanges(t *testing.T) {
	saved := captureMonitorTestState()
	oldNow := networkNow
	t.Cleanup(func() { saved.restore(); networkNow = oldNow })
	check := func(ok bool, message string) {
		t.Helper()
		if !ok {
			t.Fatal(message)
		}
	}
	networkSample = nic.Sample{}
	networkCounterEpoch = ""
	networkInterfaceSpeeds = nil
	now := time.Unix(1000, 0)
	networkNow = func() time.Time { return now }
	rows := map[string]nic.Counter{"eth0": {Index: 1, In: 100, Out: 200}, "eth1": {Index: 2, In: 300, Out: 400}}
	failed := false
	nicStateProbe = func(ctx context.Context) (nic.Sample, error) {
		if failed {
			return nic.Sample{}, errors.New("unavailable")
		}
		allow, _ := ctx.Value(nic.NICKey).(map[string]bool)
		s := nic.Sample{Interfaces: map[string]nic.Counter{}}
		for name, c := range rows {
			if nic.IsMonitored(name, allow) {
				s.Interfaces[name] = c
				s.In += c.In
				s.Out += c.Out
			}
		}
		return s, nil
	}
	step := func(cfg *model.AgentConfig) { now = now.Add(2 * time.Second); TrackNetworkSpeed(cfg) }
	step(nil)
	check(len(networkInterfaceSpeeds) == 2 && !networkInterfaceSpeeds[0].Available, "warm-up was not a gap")
	rows["eth0"] = nic.Counter{Index: 1, In: 120, Out: 240}
	rows["eth1"] = nic.Counter{Index: 2, In: 360, Out: 480}
	step(nil)
	want := []model.NetworkInterfaceSpeed{{Name: "eth0", InSpeed: 10, OutSpeed: 20, Available: true}, {Name: "eth1", InSpeed: 30, OutSpeed: 40, Available: true}}
	check(reflect.DeepEqual(want, networkInterfaceSpeeds), "interface rates mixed")
	check(netInSpeed == 40 && netOutSpeed == 60, "totals differ from selected interfaces")
	failed = true
	step(nil)
	check(!networkInterfaceSpeeds[0].Available, "failed sample reported stale rate")
	failed = false
	step(nil)
	check(networkInterfaceSpeeds[0].Available && networkInterfaceSpeeds[0].InSpeed == 0, "idle was not a valid zero")
	rows["new0"] = nic.Counter{Index: 3, In: 1 << 40, Out: 1 << 40}
	step(nil)
	check(len(networkInterfaceSpeeds) == 3 && netInSpeed == 0, "new NIC caused a spike")
	for _, n := range networkInterfaceSpeeds {
		check(!n.Available, "membership change must establish baseline")
	}
	delete(rows, "eth0")
	rows["renamed0"] = nic.Counter{Index: 1, In: 130, Out: 250}
	step(nil)
	for _, n := range networkInterfaceSpeeds {
		check(n.Name != "eth0" && !n.Available, "renamed interface reused data")
	}
	cfg := &model.AgentConfig{NICAllowlist: map[string]bool{"eth1": true}}
	step(cfg)
	check(len(networkInterfaceSpeeds) == 1 && networkInterfaceSpeeds[0].Name == "eth1", "allowlist ignored")
	rows["eth1"] = nic.Counter{Index: 2, In: 400, Out: 500}
	step(cfg)
	check(networkInterfaceSpeeds[0].InSpeed == 20 && netInSpeed == 20, "selected-only rate wrong")
	// A reporting restart establishes new counters without mutating saved selection.
	before := map[string]bool{"eth1": true}
	networkSample = nic.Sample{}
	networkCounterEpoch = ""
	step(cfg)
	check(reflect.DeepEqual(before, cfg.NICAllowlist), "restart altered configuration")
	check(len(networkInterfaceSpeeds) == 1 && !networkInterfaceSpeeds[0].Available, "restart mixed old rates")
	rows["eth1"] = nic.Counter{Index: 2, In: 1, Out: 1}
	step(cfg)
	check(!networkInterfaceSpeeds[0].Available && netInSpeed == 0, "counter rollback caused spike")
	step(&model.AgentConfig{NICAllowlist: map[string]bool{"eth1": false}})
	check(len(networkInterfaceSpeeds) == 0 && netInSpeed == 0, "all-off was not preserved")
}
