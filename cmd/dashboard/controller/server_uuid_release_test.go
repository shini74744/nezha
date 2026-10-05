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

func TestReleaseUUIDGuardsAndValidation(t *testing.T) {
	for _, tc := range []struct {
		name    string
		user    bool
		role    model.Role
		scope   string
		csrf    bool
		body    string
		allowed bool
	}{
		{"anonymous", false, model.RoleAdmin, "", true, "", false},
		{"member", true, model.RoleMember, "", true, "", false},
		{"missing csrf", true, model.RoleAdmin, "", false, "", false},
		{"insufficient PAT", true, model.RoleAdmin, model.ScopeInventoryRead, false, "", false},
		{"member admin PAT", true, model.RoleMember, model.ScopeAdminAll, false, "", false},
		{"malformed UUID", true, model.RoleAdmin, "", true, `{"uuid":"bad","block_version":1}`, false},
		{"missing version", true, model.RoleAdmin, "", true, `{"uuid":"aa555555-1111-4111-8111-111111111111"}`, false},
		{"stale version", true, model.RoleAdmin, "", true, `{"uuid":"aa555555-1111-4111-8111-111111111111","block_version":2}`, false},
		{"valid admin", true, model.RoleAdmin, "", true, "", true},
		{"valid admin PAT", true, model.RoleAdmin, model.ScopeAdminAll, false, "", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, cleanup := setupServerOwnershipFixture(t)
			defer cleanup()
			withCSRFSecret(t, "release-test-secret")
			require.NoError(t, singleton.DB.AutoMigrate(&model.ServerDeletionTombstone{}, &model.ServerOperationLog{}))
			row := model.ServerDeletionTombstone{UUID: "aa555555-1111-4111-8111-111111111111", Name: "deleted", OriginalID: 47, ReportCount: 3}
			require.NoError(t, singleton.DB.Create(&row).Error)
			router := gin.New()
			router.Use(func(c *gin.Context) {
				if tc.user {
					setAuthUser(c, 100, tc.role)
				}
				if tc.scope != "" {
					token := &model.APIToken{}
					token.SetScopes([]string{tc.scope})
					c.Set(apiTokenCtxKey, token)
				}
			})
			router.POST("/release", csrfMiddleware(), restScopeMiddleware(model.ScopeAdminAll), adminHandler(releaseDeletedAgentUUID))
			body := tc.body
			if body == "" {
				body = `{"uuid":"aa555555-1111-4111-8111-111111111111","block_version":1}`
			}
			req := httptest.NewRequest("POST", "/release", bytes.NewBufferString(body))
			req.Header.Set("Content-Type", "application/json")
			if tc.csrf {
				token := issueCSRFToken()
				req.AddCookie(&http.Cookie{Name: csrfCookieName, Value: token})
				req.Header.Set(csrfHeaderName, token)
			}
			res := httptest.NewRecorder()
			router.ServeHTTP(res, req)
			var response struct{ Success bool }
			require.NoError(t, json.Unmarshal(res.Body.Bytes(), &response))
			require.Equal(t, tc.allowed, response.Success, res.Body.String())
			require.NoError(t, singleton.DB.First(&row, "uuid = ?", row.UUID).Error)
			require.Equal(t, tc.allowed, row.ReleasedAt > 0)
			var logs int64
			require.NoError(t, singleton.DB.Model(&model.ServerOperationLog{}).Count(&logs).Error)
			if tc.allowed {
				require.EqualValues(t, 1, logs)
			} else {
				require.Zero(t, logs)
			}
			get := httptest.NewRecorder()
			router.ServeHTTP(get, httptest.NewRequest("GET", "/release", nil))
			require.Equal(t, http.StatusNotFound, get.Code)
		})
	}
}

func TestReleasedUUIDHistoryAndSubsequentFailuresStayDistinct(t *testing.T) {
	_, cleanup := setupServerOwnershipFixture(t)
	defer cleanup()
	require.NoError(t, singleton.DB.AutoMigrate(&model.ServerDeletionTombstone{}, &model.UnknownAgentReport{}, &model.AgentUUIDConflict{}, &model.AgentIdentityRejection{}))
	const value = "aa555555-1111-4111-8111-111111111111"
	require.NoError(t, singleton.DB.Create(&model.ServerDeletionTombstone{UUID: value, ReleasedAt: 10, ReportCount: 3, LastReportAt: 8}).Error)
	require.NoError(t, singleton.DB.Create(&model.UnknownAgentReport{UUID: value, ReportCount: 1, LastReportAt: 20}).Error)
	rows, err := listUnknownAgentReports(historyContext(""))
	require.NoError(t, err)
	require.Len(t, rows.Value, 2)
	require.Equal(t, "unregistered", rows.Value[0].Kind)
	require.Equal(t, "deleted", rows.Value[1].Kind)
	require.EqualValues(t, 10, rows.Value[1].ReleasedAt)
	require.EqualValues(t, 1, rows.Value[1].BlockVersion)
}
