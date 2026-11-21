package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLogoutRejectsCookieWithoutCSRFAndPAT(t *testing.T) {
	withCSRFSecret(t, "logout-test-secret")
	for _, pat := range []bool{false, true} {
		reached := false
		router := gin.New()
		router.POST("/api/v1/logout", func(c *gin.Context) {
			if pat {
				c.Set(apiTokenCtxKey, &model.APIToken{ID: 1})
			}
			c.Next()
		}, csrfMiddleware(), restPATForbiddenMiddleware(), func(c *gin.Context) { reached = true; c.Status(204) })
		request := httptest.NewRequest("POST", "/api/v1/logout", nil)
		if pat {
			request.Header.Set("Authorization", "Bearer nzp_fixture")
		} else {
			request.AddCookie(&http.Cookie{Name: "nz-jwt", Value: "session"})
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		require.Equal(t, http.StatusForbidden, response.Code)
		require.False(t, reached)
	}
}
