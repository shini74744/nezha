package singleton

import (
	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func nicFixture(t *testing.T) (string, *model.Server) {
	uuid, s := snapshotFixture(t)
	require.NoError(t, DB.AutoMigrate(&model.NICTransferCheckpoint{}, &model.NICTransferDay{}))
	s.PublicNote = `{"planDataMod":{"trafficVol":"1000GB","trafficType":"2","trafficResetDay":1}}`
	s.HomeNetworkInterfacesRaw = `["ens18"]`
	return uuid, s
}
func nicSample(at int64, in, out uint64, epoch string) model.RecordedServerState {
	s := sampleAt(at)
	s.State.NetInTransfer = 9000000
	s.State.NetOutTransfer = 8000000
	s.State.NetworkInterfaces = []model.NetworkInterfaceSpeed{
		{Name: "ens18", InTransfer: in, OutTransfer: out, CounterEpoch: epoch, CountersAvailable: true, Available: true},
		{Name: "wg0", InTransfer: in * 10, OutTransfer: out * 10, CounterEpoch: "wg", CountersAvailable: true, Available: true},
	}
	return s
}
func TestNICTransferSelectionRestartAndNoAggregateBackfill(t *testing.T) {
	uuid, s := nicFixture(t)
	at := trafficTime("2026-11-03T12:00:00+08:00").UnixMilli()
	persist := func(offset int64, in, out uint64, epoch string) {
		require.NoError(t, PersistServerSnapshot(s.ID, uuid, nicSample(at+offset, in, out, epoch)))
	}
	query := func() *model.PlanTrafficStat {
		v, e := QueryHomePlanTraffic(s, time.UnixMilli(at+100000))
		require.NoError(t, e)
		require.NotNil(t, v)
		return v
	}
	persist(0, 100000, 200000, "a")
	require.Zero(t, query().Used)
	require.True(t, query().Partial)
	persist(1000, 100010, 200020, "a")
	require.Equal(t, uint64(30), query().Used)
	// Replay and late old samples never double count.
	persist(1000, 900000, 900000, "z")
	persist(500, 900000, 900000, "z")
	require.Equal(t, uint64(30), query().Used)
	s.HomeNetworkInterfacesRaw = `["ens18","wg0"]`
	require.Equal(t, uint64(330), query().Used)
	s.HomeNetworkInterfacesRaw = `["wg0"]`
	require.Equal(t, uint64(300), query().Used)
	s.HomeNetworkInterfacesRaw = `["ens18"]`
	persist(2000, 999999, 888888, "new-agent")
	require.Equal(t, uint64(30), query().Used)
	persist(3000, 1000009, 888908, "new-agent")
	require.Equal(t, uint64(60), query().Used)
	// A successful enumeration without ens18 creates a gap, not a fallback.
	sample := nicSample(at+4000, 1000010, 888909, "new-agent")
	sample.State.NetworkInterfaces = sample.State.NetworkInterfaces[1:]
	require.NoError(t, PersistServerSnapshot(s.ID, uuid, sample))
	require.True(t, query().Partial)
	persist(5000, 5000000, 6000000, "recreated")
	require.Equal(t, uint64(60), query().Used)
	require.NoError(t, DB.Model(&model.Server{}).Where("id = ?", s.ID).Update("home_network_interfaces_raw", s.HomeNetworkInterfacesRaw).Error)
	var reopened model.Server
	require.NoError(t, DB.First(&reopened, s.ID).Error)
	require.Equal(t, s.HomeNetworkNames(), reopened.HomeNetworkNames())
	// Original aggregate accounting stays independent.
	s.HomeNetworkInterfacesRaw = "[]"
	global, e := QueryPlanTraffic(s, time.UnixMilli(at+100000))
	require.NoError(t, e)
	home, e := QueryHomePlanTraffic(s, time.UnixMilli(at+100000))
	require.NoError(t, e)
	require.Equal(t, global, home)
}
func TestNICTransferMidnightResetMissingAndIdentityFence(t *testing.T) {
	uuid, s := nicFixture(t)
	at := trafficTime("2026-10-31T23:59:59+08:00").UnixMilli()
	require.NoError(t, PersistServerSnapshot(s.ID, uuid, nicSample(at, 1000, 2000, "a")))
	require.NoError(t, PersistServerSnapshot(s.ID, uuid, nicSample(at+2000, 1020, 2040, "a")))
	october, e := QueryHomePlanTraffic(s, time.UnixMilli(at))
	require.NoError(t, e)
	require.Equal(t, uint64(30), october.Used)
	november, e := QueryHomePlanTraffic(s, time.UnixMilli(at+3000))
	require.NoError(t, e)
	require.Equal(t, uint64(30), november.Used)
	// Same epoch reset is still conservative.
	require.NoError(t, PersistServerSnapshot(s.ID, uuid, nicSample(at+4000, 1, 2, "a")))
	november, e = QueryHomePlanTraffic(s, time.UnixMilli(at+5000))
	require.NoError(t, e)
	require.Equal(t, uint64(30), november.Used)
	require.True(t, november.Partial)
	require.NoError(t, PersistServerSnapshot(s.ID, "wrong-machine", nicSample(at+6000, 5000, 6000, "a")))
	november, e = QueryHomePlanTraffic(s, time.UnixMilli(at+7000))
	require.NoError(t, e)
	require.Equal(t, uint64(30), november.Used)
	s.HomeNetworkInterfacesRaw = `["missing"]`
	missing, e := QueryHomePlanTraffic(s, time.UnixMilli(at+7000))
	require.NoError(t, e)
	require.Zero(t, missing.Used)
	require.True(t, missing.Partial)
}
