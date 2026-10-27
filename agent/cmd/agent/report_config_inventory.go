package main

import (
	"encoding/json"
	"github.com/nezhahq/agent/model"
	"github.com/nezhahq/agent/pkg/monitor/nic"
)

func marshalReportedConfig(config *model.AgentConfig, inventory nic.Inventory) ([]byte, error) {
	// Read-only inventory and internal reminder tokens are never editable config.
	data, err := json.Marshal(config)
	if err != nil {
		return nil, err
	}
	var response map[string]json.RawMessage
	if err = json.Unmarshal(data, &response); err != nil {
		return nil, err
	}
	delete(response, "nic_selection_reset_id")
	response["network_interfaces"], err = json.Marshal(inventory)
	if err != nil {
		return nil, err
	}
	return json.Marshal(response)
}
