package controller

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"

	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
)

func installFrontendPasswordConfig(t *testing.T, password string) {
	t.Helper()
	old := singleton.Conf
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	require.NoError(t, err)
	singleton.Conf = &singleton.ConfigClass{Config: &model.Config{
		ConfigForGuests: model.ConfigForGuests{SiteName: "Test"},
		ConfigDashboard: model.ConfigDashboard{FrontendPasswordHash: string(hash)},
		JWTSecretKey:    "test-signing-key",
	}}
	t.Cleanup(func() { singleton.Conf = old })
}

func TestFrontendPasswordLoginSetsSignedCookieAndRedirects(t *testing.T) {
	gin.SetMode(gin.TestMode)
	installFrontendPasswordConfig(t, "secret")
	router := gin.New()
	router.POST("/api/v1/frontend-auth", frontendPasswordLogin)

	form := url.Values{"password": {"secret"}, "next": {"/server/1"}}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/frontend-auth", strings.NewReader(form.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Accept", "text/html")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusSeeOther, recorder.Code)
	require.Equal(t, "/server/1", recorder.Header().Get("Location"))
	cookies := recorder.Result().Cookies()
	require.Len(t, cookies, 1)
	require.Equal(t, frontendPasswordCookie, cookies[0].Name)
	require.True(t, cookies[0].HttpOnly)
	require.Equal(t, frontendPasswordSignature(), cookies[0].Value)
}

func TestFrontendPasswordGateRejectsMissingCookie(t *testing.T) {
	gin.SetMode(gin.TestMode)
	installFrontendPasswordConfig(t, "secret")
	router := gin.New()
	router.GET("/protected", frontendPasswordGate(), func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	missing := httptest.NewRecorder()
	router.ServeHTTP(missing, httptest.NewRequest(http.MethodGet, "/protected", nil))
	require.Equal(t, http.StatusUnauthorized, missing.Code)

	request := httptest.NewRequest(http.MethodGet, "/protected", nil)
	request.AddCookie(&http.Cookie{
		Name: frontendPasswordCookie, Value: frontendPasswordSignature(),
	})
	allowed := httptest.NewRecorder()
	router.ServeHTTP(allowed, request)
	require.Equal(t, http.StatusNoContent, allowed.Code)
}

func TestFrontendPasswordHashIsNeverSerialized(t *testing.T) {
	payload, err := json.Marshal(model.Setting{
		ConfigDashboard:          model.ConfigDashboard{FrontendPasswordHash: "secret-hash"},
		FrontendPasswordRequired: true,
	})
	require.NoError(t, err)
	require.NotContains(t, string(payload), "secret-hash")
	require.NotContains(t, string(payload), "frontend_password_hash")
	require.Contains(t, string(payload), "\"frontend_password_required\":true")
}

func TestSanitizeFrontendNextRejectsOpenRedirectAndDashboard(t *testing.T) {
	require.Equal(t, "/", sanitizeFrontendNext("https://evil.example"))
	require.Equal(t, "/", sanitizeFrontendNext("//evil.example"))
	require.Equal(t, "/", sanitizeFrontendNext("/dashboard/settings"))
	require.Equal(t, "/server/7", sanitizeFrontendNext("/server/7"))
}
