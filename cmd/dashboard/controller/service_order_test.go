package controller

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
)

func serviceOrderContext(t *testing.T, uid uint64, role model.Role, body any) *gin.Context {
	t.Helper()
	raw, err := json.Marshal(body)
	require.NoError(t, err)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/api/v1/service/order", bytes.NewReader(raw))
	c.Request.Header.Set("Content-Type", "application/json")
	setAuthUser(c, uid, role)
	return c
}
func serviceOrderIDText(id uint64) string { return strconv.FormatUint(id, 10) }
func serviceOrderIDs() []uint64 {
	out := []uint64{}
	for _, s := range singleton.ServiceSentinelShared.GetSortedList() {
		out = append(out, s.ID)
	}
	return out
}
func TestServiceManualOrderPreservesJobsSettingsAndPublicOrder(t *testing.T) {
	setupServiceDispatchPATFixture(t)
	a := insertServiceForDispatchTest(t, model.ServiceCoverIgnoreAll, map[uint64]bool{1: true})
	b := insertServiceForDispatchTest(t, model.ServiceCoverIgnoreAll, map[uint64]bool{1: true})
	cID := insertServiceForDispatchTest(t, model.ServiceCoverIgnoreAll, map[uint64]bool{1: true})
	original := serviceOrderIDs()
	before := singleton.ServiceSentinelShared.GetList()
	ctx := serviceOrderContext(t, 100, model.RoleMember, serviceOrderForm{ServiceIDs: []uint64{cID, a, b}, OriginalIDs: original})
	_, err := updateServiceOrder(ctx)
	require.NoError(t, err)
	require.Equal(t, []uint64{cID, a, b}, serviceOrderIDs())
	for id, old := range before {
		now, ok := singleton.ServiceSentinelShared.Get(id)
		require.True(t, ok)
		require.Equal(t, old.CronJobID, now.CronJobID)
		require.Equal(t, old.Target, now.Target)
		require.Equal(t, old.SkipServers, now.SkipServers)
		require.Equal(t, old.Duration, now.Duration)
		require.Equal(t, old.GetUserID(), now.GetUserID())
		require.Zero(t, old.DisplayIndex, "an existing reader snapshot must remain unchanged")
		var row model.Service
		require.NoError(t, singleton.DB.First(&row, id).Error)
		require.Equal(t, now.DisplayIndex, row.DisplayIndex)
	}
	stats := singleton.ServiceSentinelShared.CopyStats()
	require.Greater(t, stats[cID].DisplayIndex, stats[a].DisplayIndex)
	require.Greater(t, stats[a].DisplayIndex, stats[b].DisplayIndex)
	ctx = serviceOrderContext(t, 100, model.RoleMember, serviceOrderForm{ServiceIDs: []uint64{cID, a, b}, OriginalIDs: original})
	_, err = updateServiceOrder(ctx)
	require.ErrorContains(t, err, "顺序已变化")
}
func TestServiceManualOrderRejectsIncompleteForeignAndDuplicateLists(t *testing.T) {
	setupServiceDispatchPATFixture(t)
	a := insertServiceForDispatchTest(t, model.ServiceCoverIgnoreAll, map[uint64]bool{1: true})
	b := insertServiceForDispatchTest(t, model.ServiceCoverIgnoreAll, map[uint64]bool{1: true})
	original := serviceOrderIDs()
	for _, ids := range [][]uint64{{}, {a}, {a, a}, {a, 0}, {a, b, 999}, {999, b}} {
		ctx := serviceOrderContext(t, 100, model.RoleMember, serviceOrderForm{ServiceIDs: ids, OriginalIDs: original})
		_, err := updateServiceOrder(ctx)
		require.Error(t, err)
		require.Equal(t, original, serviceOrderIDs())
	}
	ctx := serviceOrderContext(t, 101, model.RoleMember, serviceOrderForm{ServiceIDs: []uint64{b, a}, OriginalIDs: original})
	_, err := updateServiceOrder(ctx)
	require.Error(t, err)
	require.Equal(t, original, serviceOrderIDs())
}
func TestServiceManualOrderRollbackAndConcurrentListChange(t *testing.T) {
	setupServiceDispatchPATFixture(t)
	a := insertServiceForDispatchTest(t, model.ServiceCoverIgnoreAll, map[uint64]bool{1: true})
	b := insertServiceForDispatchTest(t, model.ServiceCoverIgnoreAll, map[uint64]bool{1: true})
	original := serviceOrderIDs()
	require.NoError(t, singleton.DB.Exec("CREATE TRIGGER reject_service_order BEFORE UPDATE OF display_index ON services WHEN OLD.id = "+serviceOrderIDText(a)+" BEGIN SELECT RAISE(ABORT, 'fixture'); END").Error)
	ctx := serviceOrderContext(t, 100, model.RoleMember, serviceOrderForm{ServiceIDs: []uint64{b, a}, OriginalIDs: original})
	_, err := updateServiceOrder(ctx)
	require.Error(t, err)
	require.Equal(t, original, serviceOrderIDs())
	var rows []model.Service
	require.NoError(t, singleton.DB.Find(&rows).Error)
	for _, s := range rows {
		require.Zero(t, s.DisplayIndex)
	}
	require.NoError(t, singleton.DB.Exec("DROP TRIGGER reject_service_order").Error)
	insertServiceForDispatchTest(t, model.ServiceCoverIgnoreAll, map[uint64]bool{1: true})
	ctx = serviceOrderContext(t, 100, model.RoleMember, serviceOrderForm{ServiceIDs: []uint64{b, a}, OriginalIDs: original})
	_, err = updateServiceOrder(ctx)
	require.Error(t, err)
	require.Equal(t, a, serviceOrderIDs()[0])
}
func TestServiceEditKeepsManualOrderAndCreateAppends(t *testing.T) {
	setupServiceDispatchPATFixture(t)
	a := insertServiceForDispatchTest(t, model.ServiceCoverIgnoreAll, map[uint64]bool{1: true})
	b := insertServiceForDispatchTest(t, model.ServiceCoverIgnoreAll, map[uint64]bool{1: true})
	ctx := serviceOrderContext(t, 100, model.RoleMember, serviceOrderForm{ServiceIDs: []uint64{b, a}, OriginalIDs: serviceOrderIDs()})
	_, err := updateServiceOrder(ctx)
	require.NoError(t, err)
	form := model.ServiceForm{Name: "renamed", Target: "example.invalid:80", Type: model.TaskTypeTCPPing, Cover: model.ServiceCoverIgnoreAll, Duration: 30, SkipServers: map[uint64]bool{1: true}, DisplayIndex: 9999}
	ctx = serviceOrderContext(t, 100, model.RoleMember, form)
	ctx.Params = gin.Params{{Key: "id", Value: serviceOrderIDText(a)}}
	_, err = updateService(ctx)
	require.NoError(t, err)
	require.Equal(t, []uint64{b, a}, serviceOrderIDs())
	current, _ := singleton.ServiceSentinelShared.Get(a)
	require.Equal(t, 1, current.DisplayIndex)
	ctx = serviceOrderContext(t, 100, model.RoleMember, form)
	added, err := createService(ctx)
	require.NoError(t, err)
	require.Equal(t, []uint64{b, a, added}, serviceOrderIDs())
}
