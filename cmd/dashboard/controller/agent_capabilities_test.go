package controller

import (
	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestMCPCapabilitySurvivesVersionRenumbering(t *testing.T) {
	for _, tc := range []struct {
		version      string
		capabilities []string
		want         bool
	}{
		{"1.0.0", []string{model.AgentCapabilityServerTransfer, model.AgentCapabilityMCP}, true},
		{"1.0.0", nil, false},
		{"2.3.8", nil, true},
		{"2.3.8", []string{model.AgentCapabilityServerTransfer}, false},
		{"99.0.0", []string{"unknown"}, false},
	} {
		server := &model.Server{Host: &model.Host{Version: tc.version, Capabilities: tc.capabilities}}
		require.Equal(t, tc.want, requireAgentSupportsMCP(server) == nil)
	}
}
