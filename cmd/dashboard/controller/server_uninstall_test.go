package controller

import (
	"context"
	"errors"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
)

func TestPrepareServerRemovalHandlesAllOutcomes(t *testing.T) {
	servers := make([]*model.Server, 5)
	for i := range servers {
		servers[i] = &model.Server{Common: model.Common{ID: uint64(i + 1)}, UUID: "12345678-1234-1234-1234-123456789abc", Name: "fixture", Host: &model.Host{Platform: "debian"}}
		model.InitServer(servers[i])
		if i > 0 {
			servers[i].SetTaskStream(&fakeTaskStream{})
		}
	}
	servers[2].Name = "F50-special"
	servers[3].UUID = "invalid; command"
	var mu sync.Mutex
	var called []uint64
	result := prepareServerRemoval(context.Background(), servers, func(_ context.Context, server *model.Server, command string) error {
		mu.Lock()
		defer mu.Unlock()
		called = append(called, server.ID)
		if server.ID == 2 {
			return errors.New("fixture refused")
		}
		if command == "" {
			return errors.New("empty command")
		}
		return nil
	})
	require.Empty(t, result.Deleted, "only committed deletion may populate Deleted")
	require.ElementsMatch(t, []uint64{2, 5}, called)
	for i, status := range []string{"offline", "failed", "unsupported", "unsupported", "started"} {
		require.Equal(t, status, result.Cleanup[i].Status)
		require.EqualValues(t, i+1, result.Cleanup[i].ID)
	}
	require.Contains(t, result.Cleanup[4].Message, "非卸载完成")
}

func TestDeleteServersRejectsForeignAndInsufficientPATBeforeDispatch(t *testing.T) {
	stream, reset := setupServerOwnershipFixture(t)
	defer reset()
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/", nil)
	setAuthUser(c, 200, model.RoleMember)
	_, err := deleteServersAndUninstall(c, []uint64{1})
	require.Error(t, err)
	require.Empty(t, stream.sentTasks)
	setAuthUser(c, 100, model.RoleMember)
	token := &model.APIToken{}
	token.SetScopes([]string{model.ScopeInventoryDelete})
	c.Set(apiTokenCtxKey, token)
	_, err = deleteServersAndUninstall(c, []uint64{1})
	require.ErrorContains(t, err, model.ScopeServerExec)
	require.Empty(t, stream.sentTasks)
	_, err = deleteServersAndUninstall(c, nil)
	require.Error(t, err)
}

func TestUnknownAgentReportsPaginationAndAdminGuard(t *testing.T) {
	_, reset := setupServerOwnershipFixture(t)
	defer reset()
	require.NoError(t, singleton.DB.AutoMigrate(&model.ServerDeletionTombstone{}))
	for _, row := range []model.ServerDeletionTombstone{
		{UUID: "never-reported", ReportCount: 0},
		{UUID: "older", ReportCount: 2, LastReportAt: 10},
		{UUID: "newer", ReportCount: 5, LastReportAt: 20},
	} {
		require.NoError(t, singleton.DB.Create(&row).Error)
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("GET", "/?offset=0&limit=1", nil)
	data, err := listUnknownAgentReports(c)
	require.NoError(t, err)
	require.EqualValues(t, 2, data.Pagination.Total)
	require.Len(t, data.Value, 1)
	require.Equal(t, "newer", data.Value[0].UUID)
	c, _ = gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("GET", "/?offset=-1&limit=999", nil)
	data, err = listUnknownAgentReports(c)
	require.NoError(t, err)
	require.Equal(t, 100, data.Pagination.Limit)
	require.Zero(t, data.Pagination.Offset)
	require.Len(t, data.Value, 2)
	r := gin.New()
	r.Use(func(c *gin.Context) { setAuthUser(c, 100, model.RoleMember) })
	r.GET("/unknown", pAdminHandler(listUnknownAgentReports))
	recorder := httptest.NewRecorder()
	r.ServeHTTP(recorder, httptest.NewRequest("GET", "/unknown", nil))
	require.NotContains(t, recorder.Body.String(), "newer")
	require.Contains(t, recorder.Body.String(), "permission denied")
}
