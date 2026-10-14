package model

import "slices"

const (
	AgentCapabilityServerTransfer = "server-transfer-v1"
	AgentCapabilityMCP            = "mcp-v1"
)

// Capabilities are protocol support hints, never authorization grants.
// Legacy agents omit this field and retain the existing version-based gates.
func (h *Host) HasCapability(capability string) bool {
	return h != nil && slices.Contains(h.Capabilities, capability)
}
