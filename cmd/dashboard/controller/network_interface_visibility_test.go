package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"net/http/httptest"
	"testing"
)

func TestInterfaceRatesRequireAdministrator(t *testing.T) {
	setupServerGroupVisibilityFixture(t)
	require.NoError(t, singleton.DB.AutoMigrate(&model.ServerSnapshot{}, &model.PlanTrafficCheckpoint{}, &model.PlanTrafficDay{}))
	metric := model.NetworkInterfaceMetric("eth0", "in")
	sample := model.RecordedServerState{At: 100000, State: &model.HostState{NetInSpeed: 10, NetworkInterfaces: []model.NetworkInterfaceSpeed{{Name: "eth0", InSpeed: 10, Available: true}}}}
	require.NoError(t, singleton.PersistServerSnapshot(1, "public", sample))
	for _, user := range []*model.User{nil, {Common: model.Common{ID: 100}, Role: model.RoleMember}, {Common: model.Common{ID: 1}, Role: model.RoleAdmin}} {
		admin := user != nil && user.Role.IsAdmin()
		c := newServerGroupCtx(user)
		c.Params = gin.Params{{Key: "id", Value: "1"}}
		report, err := getServerLastReport(c)
		require.NoError(t, err)
		if admin {
			require.Len(t, report.Snapshot.State.NetworkInterfaces, 1)
			require.Contains(t, report.Metrics, metric)
		} else {
			require.Empty(t, report.Snapshot.State.NetworkInterfaces)
			require.NotContains(t, report.Metrics, metric)
			require.NotContains(t, report.Recent, metric)
		}
		c.Request = httptest.NewRequest("GET", "/api/v1/server/1/metrics?metric="+metric, nil)
		_, err = getServerMetrics(c)
		if !admin {
			require.Error(t, err)
		}
	}
	servers := makeStreamTestServers()
	servers[0].State.NetworkInterfaces = sample.State.NetworkInterfaces
	for _, admin := range []bool{false, true, false} {
		got := filterServersForViewer(servers, 100, admin, true, nil)
		require.NotEmpty(t, got)
		if admin {
			require.Len(t, got[0].State.NetworkInterfaces, 1)
		} else {
			require.Empty(t, got[0].State.NetworkInterfaces)
		}
	}
}
