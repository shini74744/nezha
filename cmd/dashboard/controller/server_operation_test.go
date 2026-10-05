package controller

import (
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func historyContext(query string) *gin.Context {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("GET", "/?"+query, nil)
	return c
}

func TestServerOperationSearchPaginationAndGuards(t *testing.T) {
	_, cleanup := setupServerOwnershipFixture(t)
	defer cleanup()
	rows := []model.ServerOperationLog{
		{ServerUUID: "node-a", ServerID: 2, PreviousID: 47, ServerName: "unique-node", Action: "reassign_ids"},
		{ServerUUID: "node-b", ServerID: 47, PreviousID: 0, ServerName: "B", Action: "create"},
		{ServerUUID: "literal", ServerID: 5, ServerName: "100%_literal", Action: "edit"},
	}
	require.NoError(t, singleton.DB.Create(&rows).Error)
	for _, tc := range []struct {
		q    string
		want int64
	}{
		{"q=unique-node", 1}, {"q=47", 2}, {"q=node-a", 1}, {"q=missing", 0},
		{"q=%25", 1}, {"action=edit", 1}, {"action=invalid", 0},
	} {
		got, err := listServerOperations(historyContext(tc.q))
		require.NoError(t, err, tc.q)
		require.Equal(t, tc.want, got.Pagination.Total, tc.q)
	}
	got, err := listServerOperations(historyContext("offset=1&limit=1"))
	require.NoError(t, err)
	require.Len(t, got.Value, 1)
	require.Equal(t, "node-b", got.Value[0].ServerUUID)
	got, err = listServerOperations(historyContext("offset=-9&limit=999"))
	require.NoError(t, err)
	require.Equal(t, 100, got.Pagination.Limit)
	require.Zero(t, got.Pagination.Offset)

	router := gin.New()
	router.Use(func(c *gin.Context) { setAuthUser(c, 100, model.RoleMember) })
	router.GET("/history", pAdminHandler(listServerOperations))
	router.GET("/deleted", pAdminHandler(listDeletedServers))
	for _, path := range []string{"/history", "/deleted"} {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		require.Contains(t, w.Body.String(), "permission denied")
		require.NotContains(t, w.Body.String(), "node-a")
	}
}

func TestUnknownAndDeletedServerListsAreDistinct(t *testing.T) {
	_, cleanup := setupServerOwnershipFixture(t)
	defer cleanup()
	require.NoError(t, singleton.DB.AutoMigrate(&model.ServerDeletionTombstone{}, &model.UnknownAgentReport{}, &model.AgentUUIDConflict{}, &model.AgentIdentityRejection{}))
	require.NoError(t, singleton.DB.Model(&model.Server{}).Where("id = 1").Update("uuid", "registered").Error)
	require.NoError(t, singleton.DB.Create(&[]model.ServerDeletionTombstone{
		{UUID: "deleted-idle", Name: "offline deletion", OriginalID: 47, DeletedByName: "admin"},
		{UUID: "deleted-returning", Name: "returned", ReportCount: 2, LastReportAt: 30},
	}).Error)
	require.NoError(t, singleton.DB.Create(&[]model.UnknownAgentReport{
		{UUID: "never-registered", ReportCount: 3, LastReportAt: 40},
		{UUID: "registered", ReportCount: 4, LastReportAt: 50},
		{UUID: "deleted-returning", ReportCount: 6, LastReportAt: 60},
	}).Error)
	require.NoError(t, singleton.DB.Create(&[]model.AgentUUIDConflict{
		{UUID: "registered", ReportCount: 1, LastReportAt: 70, PreviousIP: "192.0.2.10", LastIP: "192.0.2.11"},
		{UUID: "deleted-returning", ReportCount: 1, LastReportAt: 90},
	}).Error)
	unknown, err := listUnknownAgentReports(historyContext(""))
	require.NoError(t, err)
	require.EqualValues(t, 4, unknown.Pagination.Total)
	require.Equal(t, "conflict", unknown.Value[0].Kind)
	require.Equal(t, "192.0.2.10", unknown.Value[0].PreviousIP)
	require.Equal(t, "registered", unknown.Value[1].Kind)
	require.Equal(t, "never-registered", unknown.Value[2].UUID)
	require.Equal(t, "unregistered", unknown.Value[2].Kind)
	require.Equal(t, "deleted", unknown.Value[3].Kind)
	deleted, err := listDeletedServers(historyContext(""))
	require.NoError(t, err)
	require.EqualValues(t, 2, deleted.Pagination.Total)
	ids := []string{deleted.Value[0].UUID, deleted.Value[1].UUID}
	require.ElementsMatch(t, []string{"deleted-idle", "deleted-returning"}, ids)
}

func TestServerIDReassignmentHistoryKeepsFinalIDsOnly(t *testing.T) {
	db := newServerRekeyTestDB(t)
	seedServerRekeyRecords(t, db)
	run := func(order []uint64, mapping map[uint64]uint64) {
		require.NoError(t, model.WithServerOperation(db, model.ServerOperationActor{ID: 7, Name: "admin"}, "reassign_ids", nil, func(tx *gorm.DB) error {
			return reassignServerIDsInDB(tx, order, mapping)
		}))
	}
	run([]uint64{63, 47}, map[uint64]uint64{63: 1, 47: 2})
	run([]uint64{2, 1}, map[uint64]uint64{2: 1, 1: 2})
	var rows []model.ServerOperationLog
	require.NoError(t, db.Order("id ASC").Find(&rows).Error)
	require.Len(t, rows, 4)
	require.ElementsMatch(t, []uint64{47, 63}, []uint64{rows[0].PreviousID, rows[1].PreviousID})
	for _, row := range rows {
		require.LessOrEqual(t, row.ServerID, uint64(2), "temporary relocation IDs must never appear")
		require.EqualValues(t, 7, row.ActorID)
	}
}
