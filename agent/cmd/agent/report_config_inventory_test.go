package main

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/nezhahq/agent/model"
	"github.com/nezhahq/agent/pkg/monitor/nic"
	pb "github.com/nezhahq/agent/proto"
)

func TestReportConfigInventoryIsReadOnlyAndBackwardCompatible(t *testing.T) {
	cfg := model.AgentConfig{UUID: "fixture-uuid", ClientSecret: "fixture-secret", ReportDelay: 3, NICAllowlist: map[string]bool{"eth0": true, "br0": false}}
	before := cfg.Clone()
	inventory := nic.Inventory{Available: true, Interfaces: []nic.Interface{{Name: "eth0", Kind: "physical", DefaultMonitored: true, Monitored: true}}}
	data, err := marshalReportedConfig(&cfg, inventory)
	if err != nil {
		t.Fatal(err)
	}
	var response struct {
		NetworkInterfaces nic.Inventory `json:"network_interfaces"`
	}
	if err = json.Unmarshal(data, &response); err != nil || !response.NetworkInterfaces.Available || len(response.NetworkInterfaces.Interfaces) != 1 {
		t.Fatal(string(data), err)
	}
	var legacy model.AgentConfig
	if err = json.Unmarshal(data, &legacy); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(legacy, before) || !reflect.DeepEqual(cfg, before) {
		t.Fatal("config mutated or older readers lost fields")
	}
	persisted, err := json.Marshal(legacy)
	if err != nil || strings.Contains(string(persisted), "network_interfaces") {
		t.Fatal("inventory leaked into configuration")
	}
}

func TestNICCheckboxConfigMergeAndRestoreDefaults(t *testing.T) {
	cfg := model.AgentConfig{UUID: "fixture-uuid", ClientSecret: "fixture-secret", ReportDelay: 3, NICAllowlist: map[string]bool{"eth0": true, "br0": true}}
	result := &pb.TaskResult{}
	selected, ok := parseApplyConfigLocked(&cfg, &pb.Task{Data: `{"nic_allowlist":{"eth0":true,"eth1":true,"br0":false,"ppp0":false}}`}, result)
	if !ok || !selected.NICAllowlist["eth0"] || !selected.NICAllowlist["eth1"] || selected.NICAllowlist["br0"] || selected.NICAllowlist["ppp0"] {
		t.Fatal(selected, result)
	}
	if !cfg.NICAllowlist["br0"] || selected.UUID != cfg.UUID || selected.ClientSecret != cfg.ClientSecret {
		t.Fatal("unrelated configuration changed")
	}
	allFalse, ok := parseApplyConfigLocked(&selected, &pb.Task{Data: `{"nic_allowlist":{"eth0":false,"eth1":false,"br0":false,"ppp0":false}}`}, result)
	if !ok || len(allFalse.NICAllowlist) == 0 {
		t.Fatal("all-false selection lost")
	}
	for name := range allFalse.NICAllowlist {
		if nic.IsMonitored(name, allFalse.NICAllowlist) {
			t.Fatal("unchecked interface sampled", name)
		}
	}
	reset, ok := parseApplyConfigLocked(&selected, &pb.Task{Data: `{"nic_allowlist":null}`}, result)
	if !ok || len(reset.NICAllowlist) != 0 {
		t.Fatal("restore defaults did not clear map")
	}
}
