package controller

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
)

func TestDeletedCleanupAdministratorScopesCSRFAndCAS(t *testing.T) {
	for _, tc := range []struct {
		name    string
		user    bool
		role    model.Role
		scopes  []string
		scoped  bool
		csrf    bool
		body    string
		allowed bool
	}{
		{name: "anonymous"}, {name: "member", user: true, role: model.RoleMember, csrf: true},
		{name: "missing csrf", user: true, role: model.RoleAdmin},
		{name: "admin PAT without exec", user: true, role: model.RoleAdmin, scopes: []string{model.ScopeAdminAll}},
		{name: "exec PAT without admin", user: true, role: model.RoleAdmin, scopes: []string{model.ScopeServerExec}},
		{name: "server ID scoped PAT", user: true, role: model.RoleAdmin, scopes: []string{model.ScopeNezhaAll}, scoped: true},
		{name: "valid cookie", user: true, role: model.RoleAdmin, csrf: true, allowed: true},
		{name: "valid PAT", user: true, role: model.RoleAdmin, scopes: []string{model.ScopeAdminAll, model.ScopeServerExec}, allowed: true},
		{name: "missing fields", user: true, role: model.RoleAdmin, csrf: true, body: `{"uuid":"aa555555-1111-4111-8111-111111111111","block_version":1}`},
		{name: "stale revision", user: true, role: model.RoleAdmin, csrf: true, body: `{"uuid":"aa555555-1111-4111-8111-111111111111","block_version":1,"cleanup_revision":9,"enabled":true}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, cleanup := setupServerOwnershipFixture(t)
			defer cleanup()
			withCSRFSecret(t, "fixture-cleanup-csrf")
			old := singleton.UserInfoMap
			singleton.UserInfoMap = map[uint64]model.UserInfo{100: {Role: model.RoleAdmin}}
			defer func() { singleton.UserInfoMap = old }()
			require.NoError(t, singleton.DB.AutoMigrate(&model.ServerDeletionTombstone{}, &model.ServerOperationLog{}))
			row := model.ServerDeletionTombstone{UUID: "aa555555-1111-4111-8111-111111111111", Name: "fixture", CleanupOwnerID: 100, CleanupPlatform: "ubuntu", CleanupCredentialHash: "never-expose-hash"}
			require.NoError(t, singleton.DB.Create(&row).Error)
			r := gin.New()
			r.Use(func(c *gin.Context) {
				if tc.user {
					setAuthUser(c, 100, tc.role)
				}
				if tc.scopes != nil {
					token := &model.APIToken{}
					token.SetScopes(tc.scopes)
					if tc.scoped {
						token.SetServerIDs([]uint64{42})
					}
					c.Set(apiTokenCtxKey, token)
				}
			})
			r.POST("/cleanup", csrfMiddleware(), restScopeAllOf(model.ScopeAdminAll, model.ScopeServerExec), adminHandler(configureDeletedCleanup))
			body := tc.body
			if body == "" {
				body = `{"uuid":"aa555555-1111-4111-8111-111111111111","block_version":1,"cleanup_revision":0,"enabled":true}`
			}
			req := httptest.NewRequest("POST", "/cleanup", bytes.NewBufferString(body))
			req.Header.Set("Content-Type", "application/json")
			if tc.csrf {
				token := issueCSRFToken()
				req.AddCookie(&http.Cookie{Name: csrfCookieName, Value: token})
				req.Header.Set(csrfHeaderName, token)
			}
			res := httptest.NewRecorder()
			r.ServeHTTP(res, req)
			var response struct{ Success bool }
			require.NoError(t, json.Unmarshal(res.Body.Bytes(), &response))
			require.Equal(t, tc.allowed, response.Success, res.Body.String())
			require.NotContains(t, res.Body.String(), "never-expose-hash")
			require.NotContains(t, res.Body.String(), "cleanup_owner_id")
			require.NoError(t, singleton.DB.First(&row, "uuid = ?", row.UUID).Error)
			require.Equal(t, tc.allowed, row.CleanupEnabled)
		})
	}
}
