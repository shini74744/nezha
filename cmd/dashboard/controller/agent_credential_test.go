package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func credentialControllerFixture(t *testing.T) {
	_, reset := setupServerOwnershipFixture(t)
	t.Cleanup(reset)
	require.NoError(t, singleton.DB.AutoMigrate(&model.AgentCredential{}, &model.AgentCredentialRejection{}, &model.ServerDeletionTombstone{}))
	require.NoError(t, singleton.InitAgentCredentials(filepath.Join(t.TempDir(), "agent-credentials.key")))
}
func credentialContext(method, body string, user uint64) *gin.Context {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(method, "/?limit=20", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	setAuthUser(c, user, model.RoleMember)
	return c
}
func TestUnusedCredentialsOnlyOwnUnconnectedPairs(t *testing.T) {
	credentialControllerFixture(t)
	own, err := singleton.IssueAgentCredential("", 100, model.ServerOperationActor{ID: 100})
	require.NoError(t, err)
	_, err = singleton.IssueAgentCredential("", 200, model.ServerOperationActor{ID: 200})
	require.NoError(t, err)
	used, err := singleton.IssueAgentCredential("", 100, model.ServerOperationActor{ID: 100})
	require.NoError(t, err)
	require.NoError(t, singleton.DB.Model(&model.AgentCredential{}).Where("uuid = ?", used.UUID).Update("verified_at", 123).Error)
	existing, err := singleton.IssueAgentCredential("", 100, model.ServerOperationActor{ID: 100})
	require.NoError(t, err)
	require.NoError(t, singleton.DB.Create(&model.Server{Common: model.Common{ID: 10, UserID: 100}, UUID: existing.UUID}).Error)
	data, err := listUnusedAgentCredentials(credentialContext("GET", "", 100))
	require.NoError(t, err)
	require.EqualValues(t, 1, data.Pagination.Total)
	require.Len(t, data.Value, 1)
	require.Equal(t, own.UUID, data.Value[0].UUID)
	require.NotEqual(t, own.Secret, data.Value[0].Fingerprint)
	_, err = reuseUnusedAgentCredential(credentialContext("POST", `{"uuid":"`+own.UUID+`","version":1}`, 200))
	require.Error(t, err)
}
func TestCredentialFirewallDTOCannotLeakSecretsAndAdminOnly(t *testing.T) {
	credentialControllerFixture(t)
	secret := "FixtureRejectedKey123456789012345"
	uuid := "12345678-1234-4234-8234-123456789abc"
	singleton.RecordRejectedAgentCredential(uuid, secret, "192.0.2.9")
	data, err := listRejectedAgentCredentials(historyContext(""))
	require.NoError(t, err)
	require.Len(t, data.Value, 1)
	require.True(t, data.Value[0].CanAdmit)
	r := gin.New()
	r.Use(func(c *gin.Context) { setAuthUser(c, 100, model.RoleAdmin) })
	r.GET("/credentials", pAdminHandler(listRejectedAgentCredentials))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/credentials", nil))
	require.NotContains(t, w.Body.String(), secret)
	require.NotContains(t, w.Body.String(), "secret_sealed")
	require.NotContains(t, w.Body.String(), "secret_hash")
	r2 := gin.New()
	r2.Use(func(c *gin.Context) { setAuthUser(c, 100, model.RoleMember) })
	r2.GET("/credentials", pAdminHandler(listRejectedAgentCredentials))
	r2.POST("/admit", adminHandler(admitAgentCredential))
	for _, method := range []string{"GET", "POST"} {
		path := "/credentials"
		if method == "POST" {
			path = "/admit"
		}
		w := httptest.NewRecorder()
		r2.ServeHTTP(w, httptest.NewRequest(method, path, nil))
		require.Contains(t, w.Body.String(), "permission denied")
		require.NotContains(t, w.Body.String(), uuid)
	}
}
func TestRemovedDeletedCardStillInBlacklist(t *testing.T) {
	credentialControllerFixture(t)
	row := model.ServerDeletionTombstone{UUID: "87654321-1234-4234-8234-123456789abc", Name: "retired", BlockVersion: 1, RecordDeletedAt: 123}
	require.NoError(t, singleton.DB.Create(&row).Error)
	cards, err := listDeletedServers(historyContext(""))
	require.NoError(t, err)
	require.Empty(t, cards.Value)
	blocks, err := listUUIDBlacklist(historyContext(""))
	require.NoError(t, err)
	require.Len(t, blocks.Value, 1)
	require.Equal(t, row.UUID, blocks.Value[0].UUID)
}

func TestUUIDBlacklistIncludesRejectedPairsAndKeepsDeletePrecedence(t *testing.T) {
	credentialControllerFixture(t)
	value := "12345678-1234-4234-8234-123456789abc"
	singleton.RecordRejectedAgentCredential(value, "FixtureUnknownKey1234567890123456", "192.0.2.10")
	result, err := listUUIDBlacklist(historyContext(""))
	require.NoError(t, err)
	require.Len(t, result.Value, 1)
	require.Equal(t, "rejected", result.Value[0].Kind)
	require.Equal(t, value, result.Value[0].UUID)
	require.NotZero(t, result.Value[0].CreatedAtUnix)
	require.NoError(t, singleton.DB.Model(&model.AgentCredentialRejection{}).Where("uuid = ?", value).Update("accepted_at", 123).Error)
	result, err = listUUIDBlacklist(historyContext(""))
	require.NoError(t, err)
	require.EqualValues(t, 123, result.Value[0].ReleasedAt)
	require.NoError(t, singleton.DB.Create(&model.ServerDeletionTombstone{UUID: value, Name: "retired", BlockVersion: 3, RecordDeletedAt: 123}).Error)
	result, err = listUUIDBlacklist(historyContext(""))
	require.NoError(t, err)
	require.Len(t, result.Value, 1)
	require.Equal(t, "deleted", result.Value[0].Kind)
	require.Zero(t, result.Value[0].ReleasedAt)
	require.EqualValues(t, 3, result.Value[0].BlockVersion)
}

func TestCredentialWritesRequireCSRFAndSecretEndpointsRejectPAT(t *testing.T) {
	credentialControllerFixture(t)
	withCSRFSecret(t, "isolated-csrf-signing-secret")
	patForbidden := restPATForbiddenMiddleware()
	for _, endpoint := range []string{"/agent-credentials/issue", "/agent-credentials/reuse", "/agent-credentials/delete", "/waf/credentials/admit"} {
		r := gin.New()
		r.Use(func(c *gin.Context) { setAuthUser(c, 100, model.RoleAdmin) })
		r.POST(endpoint, csrfMiddleware(), patForbidden, func(c *gin.Context) { c.Status(204) })
		request := httptest.NewRequest("POST", endpoint, strings.NewReader("{}"))
		request.AddCookie(&http.Cookie{Name: "nz-jwt", Value: "fixture"})
		response := httptest.NewRecorder()
		r.ServeHTTP(response, request)
		require.Equal(t, 403, response.Code)
		p := gin.New()
		p.Use(func(c *gin.Context) { setAuthUser(c, 100, model.RoleAdmin); c.Set(apiTokenCtxKey, &model.APIToken{}) })
		p.POST(endpoint, patForbidden, func(c *gin.Context) { c.Status(204) })
		response = httptest.NewRecorder()
		p.ServeHTTP(response, httptest.NewRequest("POST", endpoint, strings.NewReader("{}")))
		require.NotEqual(t, 204, response.Code, "PAT must not reach secret endpoint")
	}
}
