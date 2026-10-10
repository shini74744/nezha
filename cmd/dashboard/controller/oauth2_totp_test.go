package controller

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	jwt "github.com/appleboy/gin-jwt/v2"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/patrickmn/go-cache"
	"github.com/pquerna/otp/totp"
	"github.com/stretchr/testify/require"
)

func oauthTOTPFixture(t *testing.T) (*model.User, string, *gin.Engine, *jwt.GinJWTMiddleware) {
	t.Helper()
	user, _ := totpControllerFixture(t)
	secret := enableControllerTOTP(t, user)
	require.NoError(t, singleton.DB.Model(user).UpdateColumn("totp_github", true).Error)
	require.NoError(t, singleton.DB.First(user, user.ID).Error)
	oldCache := singleton.Cache
	singleton.Cache = cache.New(5*time.Minute, time.Minute)
	t.Cleanup(func() { singleton.Cache = oldCache })
	mw, err := jwt.New(initParams())
	require.NoError(t, err)
	require.NoError(t, mw.MiddlewareInit())
	r := gin.New()
	r.POST("/api/v1/oauth2/totp", csrfMiddleware(), commonHandler(verifyOAuthTOTP(mw)))
	r.GET("/api/v1/profile", mw.MiddlewareFunc(), commonHandler(getTOTPStatus))
	return user, secret, r, mw
}
func beginOAuthChallengeTest(t *testing.T, user *model.User) []*http.Cookie {
	t.Helper()
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", "https://panel.test/api/v1/oauth2/callback", nil)
	_, err := beginOAuthTOTP(c, user)
	require.ErrorIs(t, err, errNoop)
	require.Equal(t, "/dashboard/login?oauth2_totp=1", w.Header().Get("Location"))
	cookies := w.Result().Cookies()
	found := false
	for _, cookie := range cookies {
		if cookie.Name == "nz-jwt" {
			require.Empty(t, cookie.Value)
		}
		if cookie.Name == oauthTOTPCookie {
			found = true
			require.True(t, cookie.HttpOnly)
			require.True(t, cookie.Secure)
			require.Equal(t, http.SameSiteStrictMode, cookie.SameSite)
			require.Equal(t, 300, cookie.MaxAge)
		}
	}
	require.True(t, found)
	return cookies
}
func oauthChallengeValue(t *testing.T, cookies []*http.Cookie) *oauthTOTPChallenge {
	t.Helper()
	for _, cookie := range cookies {
		if cookie.Name == oauthTOTPCookie {
			value, ok := singleton.Cache.Get(oauthTOTPKey(cookie.Value))
			require.True(t, ok)
			return value.(*oauthTOTPChallenge)
		}
	}
	t.Fatal("no challenge")
	return nil
}
func oauthVerifyRequest(r *gin.Engine, cookies []*http.Cookie, code string, csrf bool) *httptest.ResponseRecorder {
	body, _ := json.Marshal(map[string]string{"code": code})
	req := httptest.NewRequest("POST", "/api/v1/oauth2/totp", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	for _, cookie := range cookies {
		if cookie.Value != "" {
			req.AddCookie(cookie)
		}
		if csrf && cookie.Name == csrfCookieName {
			req.Header.Set(csrfHeaderName, cookie.Value)
		}
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}
func sessionCount(t *testing.T) int64 {
	t.Helper()
	var count int64
	require.NoError(t, singleton.DB.Model(&model.JWTSession{}).Count(&count).Error)
	return count
}
func TestOAuthTOTPPendingIsNotLoginAndCannotSkipFactor(t *testing.T) {
	user, secret, r, _ := oauthTOTPFixture(t)
	before := sessionCount(t)
	cookies := beginOAuthChallengeTest(t, user)
	require.Equal(t, before, sessionCount(t))
	req := httptest.NewRequest("GET", "/api/v1/profile?oauth2=true&totp_verified=true", nil)
	for _, cookie := range cookies {
		req.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	require.Contains(t, w.Body.String(), "ApiErrorUnauthorized")
	for _, code := range []string{"", "bad-code", "12345", "1234567"} {
		w = oauthVerifyRequest(r, cookies, code, true)
		require.Contains(t, w.Body.String(), "ApiErrorTOTPInvalid")
		require.NotContains(t, w.Body.String(), "\"token\":")
	}
	require.Equal(t, before, sessionCount(t))
	valid, err := totp.GenerateCode(secret, time.Now())
	require.NoError(t, err)
	w = oauthVerifyRequest(r, cookies, valid, true)
	require.Contains(t, w.Body.String(), "\"success\":true")
	require.Equal(t, before+1, sessionCount(t))
	w = oauthVerifyRequest(r, cookies, valid, true)
	require.NotContains(t, w.Body.String(), "\"success\":true")
	require.Equal(t, before+1, sessionCount(t))
}
func TestOAuthTOTPRejectsForgedExpiredCSRFAndRevokedChallenges(t *testing.T) {
	for _, kind := range []string{"missing", "forged", "expired", "csrf", "changed-account", "disabled", "wrong-browser", "cache-lost"} {
		t.Run(kind, func(t *testing.T) {
			user, secret, r, _ := oauthTOTPFixture(t)
			cookies := beginOAuthChallengeTest(t, user)
			pending := oauthChallengeValue(t, cookies)
			csrf := true
			switch kind {
			case "missing":
				cookies = nil
			case "forged":
				for _, c := range cookies {
					if c.Name == oauthTOTPCookie {
						c.Value = strings.Repeat("x", 32)
					}
				}
			case "expired":
				pending.Expires = time.Now().Add(-time.Second)
			case "csrf":
				csrf = false
			case "changed-account":
				require.NoError(t, singleton.DB.Model(user).UpdateColumn("token_version", user.TokenVersion+1).Error)
			case "disabled":
				require.NoError(t, singleton.DB.Model(user).UpdateColumn("totp_github", false).Error)
			case "wrong-browser":
				pending.UA = "other-browser"
			case "cache-lost":
				singleton.Cache.Flush()
			}
			valid, err := totp.GenerateCode(secret, time.Now())
			require.NoError(t, err)
			before := sessionCount(t)
			w := oauthVerifyRequest(r, cookies, valid, csrf)
			require.NotContains(t, w.Body.String(), "\"success\":true")
			require.Equal(t, before, sessionCount(t))
		})
	}
}
func TestOAuthTOTPAccountRateLimitAndRecoverySingleUse(t *testing.T) {
	user, _, r, _ := oauthTOTPFixture(t)
	codes, hashes, err := singleton.NewTOTPRecovery(user.ID)
	require.NoError(t, err)
	require.NoError(t, singleton.DB.Model(user).UpdateColumn("totp_recovery", hashes).Error)
	cookies := beginOAuthChallengeTest(t, user)
	for i := 0; i < 5; i++ {
		require.Contains(t, oauthVerifyRequest(r, cookies, "bad-code", true).Body.String(), "ApiErrorTOTPInvalid")
	}
	require.Contains(t, oauthVerifyRequest(r, cookies, codes[0], true).Body.String(), "ApiErrorTOTPLimited")
	require.NoError(t, singleton.DB.Model(user).UpdateColumn("totp_window_start", time.Now().Unix()-301).Error)
	require.Contains(t, oauthVerifyRequest(r, cookies, codes[0], true).Body.String(), "\"success\":true")
	next := beginOAuthChallengeTest(t, user)
	require.Contains(t, oauthVerifyRequest(r, next, codes[0], true).Body.String(), "ApiErrorTOTPInvalid")
}
func TestOAuthTOTPConcurrentRedemptionCreatesOneSession(t *testing.T) {
	user, secret, r, _ := oauthTOTPFixture(t)
	cookies := beginOAuthChallengeTest(t, user)
	code, err := totp.GenerateCode(secret, time.Now())
	require.NoError(t, err)
	before := sessionCount(t)
	var wg sync.WaitGroup
	results := make(chan bool, 5)
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results <- strings.Contains(oauthVerifyRequest(r, cookies, code, true).Body.String(), "\"success\":true")
		}()
	}
	wg.Wait()
	close(results)
	success := 0
	for ok := range results {
		if ok {
			success++
		}
	}
	require.Equal(t, 1, success)
	require.Equal(t, before+1, sessionCount(t))
}
func TestTOTPGitHubPolicyRequiresExistingFactor(t *testing.T) {
	user, _, _, _ := oauthTOTPFixture(t)
	require.NoError(t, singleton.DB.Model(user).UpdateColumn("totp_github", false).Error)
	require.NoError(t, singleton.DB.First(user, user.ID).Error)
	codes, hashes, err := singleton.NewTOTPRecovery(user.ID)
	require.NoError(t, err)
	require.NoError(t, singleton.DB.Model(user).UpdateColumn("totp_recovery", hashes).Error)
	policyContext := func(password, code string, value bool) *gin.Context {
		c := totpContext(t, user, password, code)
		body, _ := json.Marshal(totpForm{Password: password, Code: code, GitHubEnabled: &value})
		c.Request = httptest.NewRequest("POST", "/api/v1/profile/totp/github", bytes.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
		return c
	}
	_, err = updateTOTPGitHub(policyContext("wrong", codes[0], true))
	require.Error(t, err)
	_, err = updateTOTPGitHub(policyContext(totpTestPassword, "", true))
	require.Error(t, err)
	before := user.TokenVersion
	result, err := updateTOTPGitHub(policyContext(totpTestPassword, codes[0], true))
	require.NoError(t, err)
	require.True(t, result.GitHubEnabled)
	require.Equal(t, 9, result.RecoveryRemaining)
	require.NoError(t, singleton.DB.First(user, user.ID).Error)
	require.Equal(t, before+1, user.TokenVersion)
	_, err = updateTOTPGitHub(policyContext(totpTestPassword, "", false))
	require.Error(t, err)
	result, err = updateTOTPGitHub(policyContext(totpTestPassword, codes[1], false))
	require.NoError(t, err)
	require.False(t, result.GitHubEnabled)
}
func TestOAuthTOTPRealCallbackDefersSessionOnlyWhenEnabled(t *testing.T) {
	for _, passwordDisabled := range []bool{false, true} {
		for _, enabled := range []bool{false, true} {
			t.Run(map[bool]string{false: "password-on/", true: "password-off/"}[passwordDisabled]+map[bool]string{false: "off", true: "on"}[enabled], func(t *testing.T) {
				user, _, _, mw := oauthTOTPFixture(t)
				require.NoError(t, singleton.DB.Model(user).UpdateColumn("totp_github", enabled).Error)
				require.NoError(t, singleton.DB.Model(user).UpdateColumn("totp_password_disabled", passwordDisabled).Error)
				require.NoError(t, singleton.DB.AutoMigrate(&model.Oauth2Bind{}))
				require.NoError(t, singleton.DB.Create(&model.Oauth2Bind{UserID: user.ID, Provider: "github", OpenID: "gh-owner"}).Error)
				provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("Content-Type", "application/json")
					if r.URL.Path == "/token" {
						_, _ = w.Write([]byte(`{"access_token":"provider-test","token_type":"Bearer"}`))
					} else {
						_, _ = w.Write([]byte(`{"id":"gh-owner"}`))
					}
				}))
				defer provider.Close()
				singleton.Conf.Oauth2 = map[string]*model.Oauth2Config{"github": {ClientID: "test", ClientSecret: "test", Endpoint: model.Oauth2Endpoint{TokenURL: provider.URL + "/token"}, UserInfoURL: provider.URL + "/user", UserIDPath: "id"}}
				singleton.Cache.Set(model.CacheKeyOauth2State+"state-cookie", &model.Oauth2State{State: "test-state", Provider: "github", RedirectURL: "http://panel.test/callback"}, time.Minute)
				w := httptest.NewRecorder()
				c, _ := gin.CreateTestContext(w)
				c.Request = httptest.NewRequest("GET", "/api/v1/oauth2/callback?state=test-state&code=provider-code", nil)
				c.Request.AddCookie(&http.Cookie{Name: "nz-o2s", Value: "state-cookie"})
				before := sessionCount(t)
				_, err := oauth2callback(mw)(c)
				require.ErrorIs(t, err, errNoop)
				if enabled {
					require.Equal(t, before, sessionCount(t))
					require.Equal(t, "/dashboard/login?oauth2_totp=1", w.Header().Get("Location"))
					for _, cookie := range w.Result().Cookies() {
						if cookie.Name == "nz-jwt" {
							require.Empty(t, cookie.Value)
						}
					}
				} else {
					require.Equal(t, before+1, sessionCount(t))
					require.Equal(t, "/dashboard/login?oauth2=true", w.Header().Get("Location"))
				}
			})
		}
	}
}
