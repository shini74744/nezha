package singleton

import (
	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestTransferCapabilitySurvivesVersionRenumbering(t *testing.T) {
	for _, tc := range []struct {
		version      string
		capabilities []string
		want         bool
	}{
		{"1.0.0", []string{model.AgentCapabilityServerTransfer, model.AgentCapabilityMCP}, true},
		{"1.0.0", nil, false},
		{"2.3.8", nil, true},
		{"2.3.8", []string{model.AgentCapabilityMCP}, false},
		{"99.0.0", []string{"unknown"}, false},
	} {
		t.Run(tc.version+"/"+string(rune(len(tc.capabilities)+'0')), func(t *testing.T) {
			server := &model.Server{Host: &model.Host{Version: tc.version, Capabilities: tc.capabilities}}
			require.Equal(t, tc.want, agentSupportsTransfer(server))
		})
	}
}
