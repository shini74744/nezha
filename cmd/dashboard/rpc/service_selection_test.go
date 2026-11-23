package rpc

import (
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestDispatchServerSelectionOverridesCoverageWithoutCrossingOwnership(t *testing.T) {
	oldServers, oldUsers := singleton.ServerShared, singleton.UserInfoMap
	t.Cleanup(func() { singleton.ServerShared = oldServers; singleton.UserInfoMap = oldUsers })
	sc := singleton.NewEmptyServerClassForTest()
	singleton.ServerShared = sc
	singleton.UserInfoMap = map[uint64]model.UserInfo{100: {Role: model.RoleMember}}
	streams := []*serveNATTaskStream{}
	for _, id := range []uint64{1, 2, 3} {
		s := &model.Server{Common: model.Common{ID: id, UserID: 100}}
		if id != 2 {
			s.ServicePreferencesRaw = `[{"service_id":11}]`
		}
		if id == 3 {
			s.SetUserID(200)
		}
		stream := &serveNATTaskStream{}
		streams = append(streams, stream)
		s.SetTaskStream(stream)
		sc.InsertForTest(s)
	}
	bus := make(chan *model.Service, 2)
	bus <- &model.Service{Common: model.Common{ID: 10, UserID: 100}, Type: model.TaskTypeTCPPing, Cover: model.ServiceCoverAll}
	bus <- &model.Service{Common: model.Common{ID: 11, UserID: 100}, Type: model.TaskTypeTCPPing, Cover: model.ServiceCoverIgnoreAll}
	close(bus)
	DispatchTask(bus)
	require.Len(t, streams[0].sent, 1)
	require.EqualValues(t, 11, streams[0].sent[0].GetId())
	require.Len(t, streams[1].sent, 1)
	require.EqualValues(t, 10, streams[1].sent[0].GetId())
	require.Empty(t, streams[2].sent)
}
