package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestLastReportVisibilityAndHistoryLimit(t *testing.T) {
	setupServerGroupVisibilityFixture(t)
	require.NoError(t, singleton.DB.AutoMigrate(&model.ServerSnapshot{}))
	old := singleton.TSDBShared
	singleton.TSDBShared = nil
	t.Cleanup(func() { singleton.TSDBShared = old })
	ctx := func(id string, user *model.User) *gin.Context {
		c := newServerGroupCtx(user)
		c.Params = gin.Params{{Key: "id", Value: id}}
		return c
	}
	guest, err := getServerLastReport(ctx("1", nil))
	require.NoError(t, err)
	require.Equal(t, 1, guest.HistoryDays)
	require.False(t, guest.TSDBEnabled)
	require.Empty(t, guest.Metrics)
	_, err = getServerLastReport(ctx("2", nil))
	require.Error(t, err)
	_, err = getServerLastReport(ctx("999", nil))
	require.Error(t, err)
	_, err = getServerLastReport(ctx("invalid", nil))
	require.Error(t, err)
	admin := &model.User{Common: model.Common{ID: 1}, Role: model.RoleAdmin}
	member, err := getServerLastReport(ctx("2", admin))
	require.NoError(t, err)
	require.Equal(t, 30, member.HistoryDays)
	tok := &model.APIToken{}
	tok.SetServerIDs([]uint64{1})
	c := ctx("2", admin)
	c.Set(model.CtxKeyAPIToken, tok)
	_, err = getServerLastReport(c)
	require.Error(t, err)
}

func TestLastReportSnapshotSurvivesOutageAndRedactsHost(t *testing.T) {
	setupServerGroupVisibilityFixture(t)
	require.NoError(t, singleton.DB.AutoMigrate(&model.ServerSnapshot{}))
	sample := model.RecordedServerState{At: 100000, Host: &model.Host{Platform: "ubuntu", PlatformVersion: "24.04", Version: "2.3.5", MemTotal: 8 << 30, DiskTotal: 100 << 30}, State: &model.HostState{MemUsed: 2 << 30, DiskUsed: 25 << 30}}
	require.NoError(t, singleton.PersistServerSnapshot(1, "public", sample))
	for _, viewer := range []*model.User{nil, {Common: model.Common{ID: 200}, Role: model.RoleMember}, {Common: model.Common{ID: 1}, Role: model.RoleAdmin}} {
		c := newServerGroupCtx(viewer)
		c.Params = gin.Params{{Key: "id", Value: "1"}}
		got, err := getServerLastReport(c)
		require.NoError(t, err)
		require.NotNil(t, got.Snapshot)
		require.EqualValues(t, 100000, got.LastReportAt)
		require.EqualValues(t, 60, got.SnapshotSeconds)
		require.EqualValues(t, 8<<30, got.Snapshot.Host.MemTotal)
		if viewer == nil || viewer.ID == 200 {
			require.Empty(t, got.Snapshot.Host.Version)
			require.Empty(t, got.Snapshot.Host.PlatformVersion)
		} else {
			require.Equal(t, "2.3.5", got.Snapshot.Host.Version)
		}
	}
}
