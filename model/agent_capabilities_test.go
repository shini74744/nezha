package model

import (
	pb "github.com/nezhahq/nezha/proto"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"
	"testing"
)

func TestRenumberedAgentHostWireAndSnapshotIsolation(t *testing.T) {
	original := &Host{Version: "1.0.0", Capabilities: []string{AgentCapabilityServerTransfer, AgentCapabilityMCP}}
	raw, err := proto.Marshal(original.PB())
	require.NoError(t, err)
	wire := &pb.Host{}
	require.NoError(t, proto.Unmarshal(raw, wire))
	reported := PB2Host(wire)
	require.Equal(t, original, &reported)
	server := &Server{}
	require.True(t, server.SetHost(&reported))
	reported.Capabilities[0] = "changed"
	snapshot := server.RuntimeSnapshot()
	require.True(t, snapshot.Host.HasCapability(AgentCapabilityServerTransfer))
	snapshot.Host.Capabilities[1] = "changed"
	require.True(t, server.RuntimeSnapshot().Host.HasCapability(AgentCapabilityMCP))
	require.Empty(t, server.RuntimeSnapshot().Host.Filter().Capabilities)
}
