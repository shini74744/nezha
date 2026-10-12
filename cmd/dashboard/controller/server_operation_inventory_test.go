package controller

import (
	"bytes"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"net/http/httptest"
	"testing"
)

func TestOperationCardsCurrentOrderAndUUID(t *testing.T) {
	_, cleanup := setupServerOwnershipFixture(t)
	defer cleanup()
	require.NoError(t, singleton.DB.Exec("DELETE FROM servers").Error)
	servers := []model.Server{
		{Common: model.Common{ID: 63}, UUID: "alpha", Name: "renamed", DisplayIndex: 10},
		{Common: model.Common{ID: 47}, UUID: "beta", Name: "beta", DisplayIndex: 20},
		{Common: model.Common{ID: 17}, UUID: "empty", Name: "empty", DisplayIndex: 0},
	}
	for i := range servers {
		require.NoError(t, singleton.DB.Create(&servers[i]).Error)
	}
	require.NoError(t, singleton.DB.Create(&[]model.ServerOperationLog{
		{ServerUUID: "alpha", ServerID: 3, PreviousID: 9, ServerName: "previous", Action: "edit"},
		{ServerUUID: "alpha", ServerID: 63, ServerName: "renamed", Action: "inventory_change"},
		{ServerUUID: "deleted", ServerID: 47, ServerName: "old beta", Action: "delete"},
	}).Error)
	got, err := listOperationServers(historyContext(""))
	require.NoError(t, err)
	require.EqualValues(t, 4, got.Pagination.Total)
	require.Equal(t, []string{"beta", "alpha", "empty", "deleted"}, []string{got.Value[0].ServerUUID, got.Value[1].ServerUUID, got.Value[2].ServerUUID, got.Value[3].ServerUUID})
	require.Greater(t, got.Value[1].LastAt, int64(0))
	require.EqualValues(t, 2, got.Value[1].Count)
	require.Equal(t, "renamed", got.Value[1].ServerName)
	require.True(t, got.Value[3].Deleted)
	got, err = listOperationServers(historyContext("q=previous"))
	require.NoError(t, err)
	require.Len(t, got.Value, 1)
	got, err = listOperationServers(historyContext("action=inventory_change&limit=1"))
	require.NoError(t, err)
	require.EqualValues(t, 1, got.Pagination.Total)
	detail, err := listServerOperations(historyContext("uuid=alpha"))
	require.NoError(t, err)
	require.EqualValues(t, 2, detail.Pagination.Total)
	// Numeric ID reuse does not leak the deleted node's records into beta.
	detail, err = listServerOperations(historyContext("uuid=beta"))
	require.NoError(t, err)
	require.Zero(t, detail.Pagination.Total)
}
func TestOperationManualDeleteScopeAndCutoff(t *testing.T) {
	_, cleanup := setupServerOwnershipFixture(t)
	defer cleanup()
	rows := []model.ServerOperationLog{{ServerUUID: "a"}, {ServerUUID: "b"}, {ServerUUID: "a"}}
	require.NoError(t, singleton.DB.Create(&rows).Error)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/", bytes.NewBufferString(`{"uuid":"a","through_id":2}`))
	c.Request.Header.Set("Content-Type", "application/json")
	n, err := deleteServerOperationHistory(c)
	require.NoError(t, err)
	require.EqualValues(t, 1, n)
	var remaining []model.ServerOperationLog
	require.NoError(t, singleton.DB.Find(&remaining).Error)
	require.Len(t, remaining, 2)
	require.Equal(t, "b", remaining[0].ServerUUID)
}

func TestOperationCategoryFiltersAcrossHistoryBeforePaging(t *testing.T) {
	_, cleanup := setupServerOwnershipFixture(t)
	defer cleanup()
	require.NoError(t, singleton.DB.Exec("DELETE FROM servers").Error)
	require.NoError(t, singleton.DB.Create(&model.Server{Common: model.Common{ID: 7}, UUID: "category", Name: "node"}).Error)
	for i := 0; i < 25; i++ {
		require.NoError(t, singleton.DB.Create(&model.ServerOperationLog{ServerUUID: "category", Action: "inventory_change", Changes: []model.ServerOperationChange{{Field: "memory_total", Before: "4", After: "8"}}}).Error)
	}
	require.NoError(t, singleton.DB.Create(&model.ServerOperationLog{ServerUUID: "category", Action: "inventory_change", Changes: []model.ServerOperationChange{{Field: "cpu", Before: "a", After: "b"}, {Field: "memory_total", Before: "4", After: "8"}}}).Error)
	page, err := listServerOperations(historyContext("uuid=category&field=cpu&limit=1"))
	require.NoError(t, err)
	require.EqualValues(t, 1, page.Pagination.Total)
	require.Len(t, page.Value[0].Changes, 1)
	require.Equal(t, "cpu", page.Value[0].Changes[0].Field)
	page, err = listServerOperations(historyContext("uuid=category&field=memory&offset=20&limit=10"))
	require.NoError(t, err)
	require.EqualValues(t, 26, page.Pagination.Total)
	require.Len(t, page.Value, 6)
	cards, err := listOperationServers(historyContext("field=cpu"))
	require.NoError(t, err)
	require.EqualValues(t, 1, cards.Pagination.Total)
	require.EqualValues(t, 1, cards.Value[0].Count)
	cards, err = listOperationServers(historyContext("field=region"))
	require.NoError(t, err)
	require.Zero(t, cards.Pagination.Total)
	_, err = listServerOperations(historyContext("field=invalid"))
	require.Error(t, err)
}
