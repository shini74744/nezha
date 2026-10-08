package singleton

import (
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/tsdb"
	"github.com/stretchr/testify/require"
	"sync"
	"sync/atomic"
	"testing"
)

func shutdownSentinelFixture(t *testing.T) *ServiceSentinel {
	ss := newServiceMonitorSecurityHarness(t, &model.Server{Common: model.Common{ID: 1, UserID: 100}, Name: "shutdown-test"})
	addServiceMonitorSecurityService(t, ss, &model.Service{Common: model.Common{ID: 10, UserID: 100}, Type: model.TaskTypeTCPPing, Target: "example.invalid:443", Duration: 3600, Cover: model.ServiceCoverIgnoreAll, SkipServers: map[uint64]bool{1: true}})
	return ss
}
func TestServiceSentinelStopDrainsBacklogAndRejectsLateReports(t *testing.T) {
	ss := shutdownSentinelFixture(t)
	entered := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	ss.serviceReportValidatedHook = func(uint64) { once.Do(func() { close(entered); <-release }) }
	var releaseOnce sync.Once
	t.Cleanup(func() { releaseOnce.Do(func() { close(release) }); ss.Close() })
	require.True(t, ss.Dispatch(serviceMonitorResult(1, 10, model.TaskTypeTCPPing, true)))
	<-entered
	for range 200 {
		require.True(t, ss.Dispatch(serviceMonitorResult(1, 10, model.TaskTypeTCPPing, true)))
	}
	stopped := ss.Stop()
	require.False(t, ss.Dispatch(serviceMonitorResult(1, 10, model.TaskTypeTCPPing, true)))
	select {
	case <-stopped:
		t.Fatal("drain completed before accepted reports")
	default:
	}
	releaseOnce.Do(func() { close(release) })
	<-stopped
	ss.Close()
	require.NoError(t, ss.ShutdownError())
	var n int64
	require.NoError(t, DB.Model(&model.ServiceHistory{}).Where("service_id=10 AND server_id=1").Count(&n).Error)
	require.Equal(t, int64(201), n)
}
func TestServiceSentinelStopConcurrentDispatchExactlyOnce(t *testing.T) {
	ss := shutdownSentinelFixture(t)
	var accepted atomic.Int64
	var wg sync.WaitGroup
	start := make(chan struct{})
	for range 64 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			for range 10 {
				if ss.Dispatch(serviceMonitorResult(1, 10, model.TaskTypeTCPPing, true)) {
					accepted.Add(1)
				}
			}
		}()
	}
	close(start)
	ss.Close()
	wg.Wait()
	ss.Close()
	require.NoError(t, ss.ShutdownError())
	var n int64
	require.NoError(t, DB.Model(&model.ServiceHistory{}).Where("service_id=10 AND server_id=1").Count(&n).Error)
	require.Equal(t, accepted.Load(), n)
}
func TestServiceSentinelStopPersistsPartialAverageAcrossTSDBReopen(t *testing.T) {
	ss := shutdownSentinelFixture(t)
	Conf.AvgPingCount = 5
	Conf.TSDB.DataPath = t.TempDir()
	Conf.TSDB.MaxMemoryMB = 32
	require.NoError(t, InitTSDB())
	config := *TSDBShared.Config()
	t.Cleanup(func() { require.NoError(t, CloseTSDB()) })
	require.False(t, DB.Migrator().HasTable("service_histories"))
	first := serviceMonitorResult(1, 10, model.TaskTypeTCPPing, true)
	first.Data.Delay = 10
	second := serviceMonitorResult(1, 10, model.TaskTypeTCPPing, true)
	second.Data.Delay = 30
	require.True(t, ss.Dispatch(first))
	require.True(t, ss.Dispatch(second))
	ss.Close()
	require.NoError(t, ss.ShutdownError())
	require.True(t, TSDBEnabled(), "worker must drain while storage stays open")
	CloseTSDB()
	reopened, err := tsdb.Open(&config)
	require.NoError(t, err)
	defer reopened.Close()
	history, err := reopened.QueryServiceHistory(10, tsdb.Period1Day)
	require.NoError(t, err)
	require.Len(t, history.Servers, 1)
	require.Equal(t, uint64(1), history.Servers[0].Stats.TotalUp)
	require.False(t, ss.Dispatch(first))
}
func TestServiceSentinelStopPersistsPartialAverageSQLite(t *testing.T) {
	ss := shutdownSentinelFixture(t)
	Conf.AvgPingCount = 5
	report := serviceMonitorResult(1, 10, model.TaskTypeTCPPing, true)
	report.Data.Delay = 25
	require.True(t, ss.Dispatch(report))
	ss.Close()
	require.NoError(t, ss.ShutdownError())
	var history model.ServiceHistory
	require.NoError(t, DB.Where("service_id=10 AND server_id=1").First(&history).Error)
	require.Equal(t, float64(25), history.AvgDelay)
}
