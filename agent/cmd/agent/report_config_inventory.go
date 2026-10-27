package main

import (
	"encoding/json"

	"github.com/nezhahq/agent/model"
	"github.com/nezhahq/agent/pkg/monitor/nic"
)

func marshalReportedConfig(config *model.AgentConfig, inventory nic.Inventory) ([]byte, error) {
	// Embedding preserves the existing config response for older dashboards.
	// Metadata is deliberately absent from AgentConfig, persistence and reload.
	return json.Marshal(struct {
		*model.AgentConfig
		NetworkInterfaces nic.Inventory `json:"network_interfaces"`
	}{config, inventory})
}
