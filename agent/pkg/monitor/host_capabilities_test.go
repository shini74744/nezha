package monitor

import (
	"slices"
	"testing"

	"github.com/nezhahq/agent/model"
)

func TestGetHostPublishesOwnedCapabilities(t *testing.T) {
	config := &model.AgentConfig{GPU: true, Temperature: true}
	observed := installMonitorSnapshotProbeBarrier(t, config, func() {})
	TrackNetworkSpeed(config)
	GetState(config, true, true)
	first := GetHost(config)
	observed.waitTemperatureUpdate()
	if !slices.Contains(first.Capabilities, "server-transfer-v1") || !slices.Contains(first.Capabilities, "mcp-v1") {
		t.Fatalf("missing owned capabilities: %v", first.Capabilities)
	}
	first.Capabilities[0] = "mutated"
	second := GetHost(config)
	if !slices.Contains(second.Capabilities, "server-transfer-v1") {
		t.Fatal("capabilities alias another host report")
	}
}
