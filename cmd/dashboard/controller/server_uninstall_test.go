package controller

import (
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
)

func TestPlanServerRemovalNeverExecutesBeforeDeletion(t *testing.T) {
	for _, tc := range []struct {
		name, uuid string
		online     bool
		status     string
	}{
		{"offline", "12345678-1234-1234-1234-123456789abc", false, "offline"},
		{"online", "12345678-1234-1234-1234-123456789abc", true, "queued"},
		{"F50", "12345678-1234-1234-1234-123456789abc", true, "unsupported"},
		{"bad", "invalid; command", true, "unsupported"},
	} {
		server := &model.Server{Common: model.Common{ID: 1}, UUID: tc.uuid, Name: tc.name, Host: &model.Host{Platform: "debian"}}
		model.InitServer(server)
		stream := &fakeTaskStream{}
		if tc.online {
			server.SetTaskStream(stream)
		}
		plan := planServerRemoval(server)
		require.Equal(t, tc.status, plan.result.Status)
		require.Empty(t, stream.sentTasks)
		require.Equal(t, tc.status == "queued", plan.launch != nil)
	}
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
	require.NoError(t, singleton.DB.AutoMigrate(&model.ServerDeletionTombstone{}, &model.UnknownAgentReport{}, &model.AgentUUIDConflict{}, &model.AgentIdentityRejection{}))
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
