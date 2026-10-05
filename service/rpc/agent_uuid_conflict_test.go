package rpc

import (
	"context"
	"net"
	"testing"
	"time"

	"github.com/nezhahq/nezha/model"
	pb "github.com/nezhahq/nezha/proto"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/peer"
)

func conflictContext(ip string, port int, uuid string) (context.Context, context.CancelFunc) {
	ctx := peer.NewContext(context.Background(), &peer.Peer{Addr: &net.TCPAddr{IP: net.ParseIP(ip), Port: port}})
	ctx = metadata.NewIncomingContext(ctx, metadata.Pairs("client_secret", "reporter-secret", "client_uuid", uuid))
	return context.WithCancel(ctx)
}

func TestUUIDConflictOnlyConcurrentDistinctConnections(t *testing.T) {
	for _, tc := range []struct {
		name, oldIP, newIP         string
		canceled, noPeer, samePeer bool
		want                       int64
	}{
		{"different machines", "192.0.2.1", "192.0.2.2", false, false, false, 1},
		{"shared NAT still distinct", "192.0.2.1", "192.0.2.1", false, false, false, 1},
		{"normal canceled reconnect", "192.0.2.1", "192.0.2.2", true, false, false, 0},
		{"one transport", "192.0.2.1", "192.0.2.1", false, false, true, 0},
		{"missing transport evidence", "192.0.2.1", "192.0.2.2", false, true, false, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			reporter := requestTaskSecurityServer(7, 200, "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee")
			setupRequestTaskSecurityFixture(t, []*model.Server{reporter}, nil, map[uint64]model.UserInfo{200: {Role: model.RoleMember}}, map[string]uint64{"reporter-secret": 200})
			require.NoError(t, singleton.DB.AutoMigrate(&model.AgentUUIDConflict{}))
			// The fixture populates the runtime and persisted server inventory.
			oldCtx, cancelOld := conflictContext(tc.oldIP, 1001, reporter.UUID)
			newPort := 1002
			if tc.samePeer {
				newPort = 1001
			}
			newCtx, cancelNew := conflictContext(tc.newIP, newPort, reporter.UUID)
			defer cancelOld()
			defer cancelNew()
			if tc.noPeer {
				newCtx = metadata.NewIncomingContext(context.Background(), metadata.Pairs("client_secret", "reporter-secret", "client_uuid", reporter.UUID))
			}
			oldStop, newStop := make(chan struct{}), make(chan struct{})
			oldStream := &stateGenerationHandlerStream{ctx: oldCtx, states: make(chan *pb.State, 1), receipts: make(chan *pb.Receipt, 2), stop: oldStop}
			newStream := &stateGenerationHandlerStream{ctx: newCtx, states: make(chan *pb.State, 1), receipts: make(chan *pb.Receipt, 2), stop: newStop}
			handler := NewNezhaHandler()
			oldDone, newDone := make(chan error, 1), make(chan error, 1)
			await := func(ch <-chan *pb.Receipt) {
				t.Helper()
				select {
				case <-ch:
				case <-time.After(5 * time.Second):
					t.Fatal("receipt timed out")
				}
			}
			oldStream.states <- &pb.State{Uptime: 11}
			go func() { oldDone <- handler.ReportSystemState(oldStream) }()
			await(oldStream.receipts)
			if tc.canceled {
				cancelOld()
			}
			newStream.states <- &pb.State{Uptime: 22}
			go func() { newDone <- handler.ReportSystemState(newStream) }()
			await(newStream.receipts)
			var count int64
			require.NoError(t, singleton.DB.Model(&model.AgentUUIDConflict{}).Count(&count).Error)
			require.Equal(t, tc.want, count)
			if tc.want > 0 {
				var row model.AgentUUIDConflict
				require.NoError(t, singleton.DB.First(&row).Error)
				require.Equal(t, tc.oldIP, row.PreviousIP)
				require.Equal(t, tc.newIP, row.LastIP)
				require.EqualValues(t, 1, row.ReportCount)
			}
			// A displaced stream cannot overwrite the replacement's sample.
			oldStream.states <- &pb.State{Uptime: 99}
			select {
			case err := <-oldDone:
				require.EqualError(t, err, "state stream superseded")
			case <-time.After(5 * time.Second):
				t.Fatal("old stream stuck")
			}
			current, _ := singleton.ServerShared.Get(7)
			require.EqualValues(t, 22, current.RuntimeSnapshot().State.Uptime)
			close(newStop)
			require.ErrorIs(t, <-newDone, context.Canceled)
			var finalCount int64
			require.NoError(t, singleton.DB.Model(&model.AgentUUIDConflict{}).Count(&finalCount).Error)
			require.Equal(t, tc.want, finalCount)
		})
	}
}

func TestUUIDConflictDoesNotCreateUnregisteredIdentity(t *testing.T) {
	defer setupAuthHandshakeFixture(t)()
	require.NoError(t, singleton.DB.AutoMigrate(&model.AgentUUIDConflict{}))
	a, ca := conflictContext("192.0.2.1", 1234, unregisteredAuthUUID)
	defer ca()
	b, cb := conflictContext("192.0.2.2", 1234, unregisteredAuthUUID)
	defer cb()
	recordUUIDConflict(unregisteredAuthUUID, a, b)
	var count int64
	require.NoError(t, singleton.DB.Model(&model.AgentUUIDConflict{}).Count(&count).Error)
	require.Zero(t, count)
}
