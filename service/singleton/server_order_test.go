package singleton

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"net/http/httptest"
	"testing"
)

func manualOrderFixture(t *testing.T) *gin.Context {
	setupPermanentDeleteTest(t)
	for _, id := range []uint64{7, 2, 9} {
		require.NoError(t, DB.Create(&model.Server{Common: model.Common{ID: id, UserID: 1}, UUID: fmt.Sprintf("manual-fixture-%d", id), Name: fmt.Sprintf("server-%d", id), DisplayIndex: 1000 + int(id), PublicNote: "preserve", Note: "private", BGPDisabled: true, EnableDDNS: true}).Error)
	}
	ServerShared = NewServerClass()
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Set(model.CtxKeyAuthorizedUser, &model.User{Common: model.Common{ID: 1}, Username: "admin", Role: model.RoleAdmin})
	return ctx
}
func TestManualOrderPersistsExactOrderAndNoop(t *testing.T) {
	ctx := manualOrderFixture(t)
	before, _ := ServerShared.Get(7)
	beforeRuntime := before.RuntimeSnapshot()
	require.NoError(t, ServerShared.UpdateManualOrder(ctx, []uint64{9, 7, 2}))
	for i, id := range []uint64{9, 7, 2} {
		var row model.Server
		require.NoError(t, DB.First(&row, id).Error)
		require.Equal(t, 3-i, row.DisplayIndex)
		require.Equal(t, fmt.Sprintf("manual-fixture-%d", id), row.UUID)
		require.Equal(t, "preserve", row.PublicNote)
		require.Equal(t, "private", row.Note)
		require.True(t, row.BGPDisabled)
		require.True(t, row.EnableDDNS)
		cached, _ := ServerShared.Get(id)
		require.Equal(t, 3-i, cached.DisplayIndex)
	}
	require.Equal(t, []uint64{9, 7, 2}, []uint64{ServerShared.GetSortedList()[0].ID, ServerShared.GetSortedList()[1].ID, ServerShared.GetSortedList()[2].ID})
	cached, _ := ServerShared.Get(7)
	require.Equal(t, beforeRuntime.State, cached.RuntimeSnapshot().State)
	require.NoError(t, ServerShared.UpdateManualOrder(ctx, []uint64{9, 7, 2}))
	var logs []model.ServerOperationLog
	require.NoError(t, DB.Find(&logs).Error)
	require.Len(t, logs, 3)
	for _, entry := range logs {
		require.Equal(t, "order", entry.Action)
		require.Len(t, entry.Changes, 1)
		require.Equal(t, "display_index", entry.Changes[0].Field)
	}
}
func TestManualOrderRejectsIncompleteStaleDuplicateUnauthorized(t *testing.T) {
	ctx := manualOrderFixture(t)
	for _, ids := range [][]uint64{nil, {7}, {7, 9, 999}, {7, 7, 9}, {7, 9, 0}} {
		require.Error(t, ServerShared.UpdateManualOrder(ctx, ids))
	}
	ctx.Set(model.CtxKeyAuthorizedUser, &model.User{Common: model.Common{ID: 1}, Role: model.RoleMember})
	require.ErrorContains(t, ServerShared.UpdateManualOrder(ctx, []uint64{7, 9, 2}), "permission denied")
	ctx.Set(model.CtxKeyAuthorizedUser, &model.User{Common: model.Common{ID: 1}, Role: model.RoleAdmin})
	token := &model.APIToken{}
	token.SetServerIDs([]uint64{7})
	ctx.Set(model.CtxKeyAPIToken, token)
	require.Error(t, ServerShared.UpdateManualOrder(ctx, []uint64{7, 9, 2}))
	ServerIDReassignmentInProgress.Store(true)
	t.Cleanup(func() { ServerIDReassignmentInProgress.Store(false) })
	require.Error(t, ServerShared.UpdateManualOrder(ctx, []uint64{7, 9, 2}))
	var rows []model.Server
	require.NoError(t, DB.Find(&rows).Error)
	for i := range rows {
		row := &rows[i]
		require.Equal(t, 1000+int(row.ID), row.DisplayIndex)
	}
	var count int64
	require.NoError(t, DB.Model(&model.ServerOperationLog{}).Count(&count).Error)
	require.Zero(t, count)
}
func TestManualOrderAuditFailureRollsBack(t *testing.T) {
	ctx := manualOrderFixture(t)
	require.NoError(t, DB.Exec("CREATE TRIGGER order_audit_failure BEFORE INSERT ON server_operation_logs BEGIN SELECT RAISE(ABORT,'audit blocked'); END").Error)
	require.Error(t, ServerShared.UpdateManualOrder(ctx, []uint64{7, 9, 2}))
	for _, id := range []uint64{7, 9, 2} {
		var row model.Server
		require.NoError(t, DB.First(&row, id).Error)
		require.Equal(t, 1000+int(id), row.DisplayIndex)
		cached, _ := ServerShared.Get(id)
		require.Equal(t, 1000+int(id), cached.DisplayIndex)
	}
}
