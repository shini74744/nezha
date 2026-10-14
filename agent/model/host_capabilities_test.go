package model

import (
	pb "github.com/nezhahq/agent/proto"
	"google.golang.org/protobuf/proto"
	"testing"
)

func TestRenumberedHostReportsVersionAndCapabilities(t *testing.T) {
	host := &Host{Version: "1.0.0", Capabilities: []string{"server-transfer-v1", "mcp-v1"}}
	data, err := proto.Marshal(host.PB())
	if err != nil {
		t.Fatal(err)
	}
	decoded := &pb.Host{}
	if err = proto.Unmarshal(data, decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.GetVersion() != "1.0.0" || len(decoded.GetCapabilities()) != 2 || decoded.GetCapabilities()[0] != "server-transfer-v1" || decoded.GetCapabilities()[1] != "mcp-v1" {
		t.Fatalf("capabilities lost: %v", decoded)
	}
}
