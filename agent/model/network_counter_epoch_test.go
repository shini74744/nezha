package model

import (
	pb "github.com/nezhahq/agent/proto"
	"google.golang.org/protobuf/proto"
	"testing"
)

func TestNetworkCounterEpochWireRoundTrip(t *testing.T) {
	before := (&HostState{NetworkCounterEpoch: "counter-epoch", NetInTransfer: 123}).PB()
	data, err := proto.Marshal(before)
	if err != nil {
		t.Fatal(err)
	}
	var after pb.State
	if err := proto.Unmarshal(data, &after); err != nil {
		t.Fatal(err)
	}
	if after.GetNetworkCounterEpoch() != "counter-epoch" || after.NetInTransfer != 123 {
		t.Fatal(&after)
	}
}
