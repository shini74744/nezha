package controller

import (
	"bytes"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLogoFetchRejectsInput(t *testing.T) {
	for _, body := range []string{`{"url":"http://127.0.0.1"}`, `{"url":"https://example.com","mode":"bad"}`, strings.Repeat("x", 5000)} {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest("POST", "/api/v1/logo/fetch", strings.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
		_, e := fetchWebsiteLogo(c)
		require.Error(t, e)
	}
}
func TestLogoFetchAdminOnly(t *testing.T) {
	cleanup, _ := setupMCPTest(t)
	defer cleanup()
	for _, role := range []model.Role{model.RoleMember, model.RoleAdmin} {
		called := false
		r := gin.New()
		r.POST("/logo/fetch", func(c *gin.Context) { c.Set(model.CtxKeyAuthorizedUser, &model.User{Role: role}) }, adminHandler(func(c *gin.Context) (any, error) { called = true; return nil, nil }))
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/logo/fetch", bytes.NewReader([]byte("{}"))))
		require.Equal(t, role == model.RoleAdmin, called)
	}
}
