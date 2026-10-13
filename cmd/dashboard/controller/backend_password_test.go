package controller

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/i18n"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func installBackendTest(t *testing.T) string {
	t.Helper()
	oldDB, oldConf, oldLocalizer := singleton.DB, singleton.Conf, singleton.Localizer
	path := filepath.Join(t.TempDir(), "attempts.db")
	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.BackendAccessAttempt{}))
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	hash, err := bcrypt.GenerateFromPassword([]byte("fixture-backend"), bcrypt.MinCost)
	require.NoError(t, err)
	singleton.DB = db
	singleton.Conf = &singleton.ConfigClass{Config: &model.Config{JWTSecretKey: "fixture-signing-key", ConfigDashboard: model.ConfigDashboard{
		BackendPasswordHash: string(hash), FrontendPasswordHash: string(hash),
	}}}
	singleton.Localizer = i18n.NewLocalizer("zh_CN", "nezha", "translations", i18n.Translations)
	t.Cleanup(func() {
		sqlDB.Close()
		singleton.DB = oldDB
		singleton.Conf = oldConf
		singleton.Localizer = oldLocalizer
	})
	return path
}
func backendTestContext(ip, method, path, body string) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(method, path, strings.NewReader(body))
	c.Request.RemoteAddr = ip + ":1234"
	c.Set(model.CtxKeyRealIPStr, ip)
	return c, w
}
func postBackendTest(ip, password string) *httptest.ResponseRecorder {
	tokenCtx, _ := backendTestContext(ip, "GET", "/dashboard/", "")
	token := issueBackendToken(tokenCtx, currentBackendAccessConfig(), "form", 20*time.Minute)
	values := url.Values{"password": {password}, "csrf": {token}, "next": {"/dashboard/profile"}}
	c, w := backendTestContext(ip, "POST", "/api/v1/backend-auth", values.Encode())
	c.Request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	backendPasswordLogin(c)
	c.Writer.WriteHeaderNow()
	return w
}
func TestBackendPasswordBanPersistenceAndIsolation(t *testing.T) {
	path := installBackendTest(t)
	w := postBackendTest("192.0.2.10", "incorrect")
	require.Equal(t, 429, w.Code)
	require.Equal(t, "900", w.Header().Get("Retry-After"))
	require.Empty(t, w.Result().Cookies())
	require.Contains(t, w.Body.String(), "已封禁")
	c, _ := backendTestContext("192.0.2.10", "GET", "/dashboard/", "")
	cfg := currentBackendAccessConfig()
	c.Request.AddCookie(&http.Cookie{Name: backendPasswordCookie, Value: issueBackendToken(c, cfg, "access", 8*time.Hour)})
	require.False(t, checkBackendAccess(c, cfg, "/dashboard/"), "valid cookie does not bypass IP ban")
	reopened, err := gorm.Open(sqlite.Open(path), &gorm.Config{})
	require.NoError(t, err)
	var row model.BackendAccessAttempt
	require.NoError(t, reopened.First(&row, "ip = ?", "192.0.2.10").Error)
	require.Equal(t, 1, row.Failures)
	require.Greater(t, row.BannedUntil, time.Now().Unix())
	connection, err := reopened.DB()
	require.NoError(t, err)
	require.NoError(t, connection.Close())
	require.Equal(t, 429, postBackendTest("192.0.2.10", "fixture-backend").Code)
	good := postBackendTest("192.0.2.11", "fixture-backend")
	require.Equal(t, 303, good.Code)
	require.Equal(t, "/dashboard/profile", good.Header().Get("Location"))
	cookies := good.Result().Cookies()
	require.Len(t, cookies, 1)
	require.True(t, cookies[0].HttpOnly)
	require.Equal(t, http.SameSiteLaxMode, cookies[0].SameSite)
	other, _ := backendTestContext("192.0.2.11", "GET", "/dashboard/", "")
	other.Request.AddCookie(cookies[0])
	require.True(t, checkBackendAccess(other, cfg, "/dashboard/"))
	front, fw := backendTestContext("192.0.2.10", "POST", "/api/v1/frontend-auth", `{"password":"fixture-backend"}`)
	front.Request.Header.Set("Content-Type", "application/json")
	frontendPasswordLogin(front)
	require.Equal(t, 200, fw.Code, "backend bans never block frontend password login")
	require.NoError(t, singleton.DB.Model(&model.BackendAccessAttempt{}).Where("ip = ?", "192.0.2.10").Updates(map[string]any{"banned_until": time.Now().Unix() - 1, "expires_at": time.Now().Unix() - 1}).Error)
	require.Equal(t, 303, postBackendTest("192.0.2.10", "fixture-backend").Code)
}
func TestBackendPasswordThresholdResetRotation(t *testing.T) {
	installBackendTest(t)
	singleton.Conf.BackendPasswordFailures = 2
	singleton.Conf.BackendPasswordBanMinutes = 3
	require.Equal(t, 401, postBackendTest("192.0.2.1", "bad").Code)
	require.Equal(t, 303, postBackendTest("192.0.2.1", "fixture-backend").Code)
	require.Equal(t, 401, postBackendTest("192.0.2.1", "bad").Code)
	w := postBackendTest("192.0.2.1", "bad")
	require.Equal(t, 429, w.Code)
	require.Equal(t, "180", w.Header().Get("Retry-After"))
	cfg := currentBackendAccessConfig()
	c, _ := backendTestContext("192.0.2.1", "GET", "/dashboard/", "")
	token := issueBackendToken(c, cfg, "access", 8*time.Hour)
	require.True(t, validBackendToken(c, cfg, token, "access", 8*time.Hour))
	require.False(t, validBackendToken(c, cfg, token, "form", 20*time.Minute))
	require.False(t, validBackendToken(c, cfg, issueBackendToken(c, cfg, "access", -time.Minute), "access", 8*time.Hour))
	singleton.Conf.BackendPasswordHash = "rotated"
	require.False(t, validBackendToken(c, currentBackendAccessConfig(), token, "access", 8*time.Hour))
	row, err := backendAttempt(c, currentBackendAccessConfig())
	require.NoError(t, err)
	require.Zero(t, row.BannedUntil)
	other, _ := backendTestContext("192.0.2.2", "GET", "/dashboard/", "")
	require.False(t, validBackendToken(other, cfg, token, "access", 8*time.Hour))
}
func TestBackendPasswordMalformedAndCSRFDoNotBan(t *testing.T) {
	installBackendTest(t)
	for _, body := range []string{`{"password":"bad"}`, `{"password":"bad","csrf":"forged"}`, strings.Repeat("x", 3000)} {
		c, w := backendTestContext("192.0.2.1", "POST", "/api/v1/backend-auth", body)
		c.Request.Header.Set("Content-Type", "application/json")
		backendPasswordLogin(c)
		require.Contains(t, []int{400, 403}, w.Code)
	}
	c, _ := backendTestContext("192.0.2.1", "GET", "/dashboard/", "")
	token := issueBackendToken(c, currentBackendAccessConfig(), "form", 20*time.Minute)
	body := url.Values{"password": {"bad"}, "csrf": {token}}.Encode()
	c, w := backendTestContext("192.0.2.1", "POST", "/api/v1/backend-auth", body)
	c.Request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	c.Request.Header.Set("Origin", "https://attacker.invalid")
	backendPasswordLogin(c)
	require.Equal(t, 403, w.Code)
	var count int64
	require.NoError(t, singleton.DB.Model(&model.BackendAccessAttempt{}).Count(&count).Error)
	require.Zero(t, count)
}
func TestBackendPasswordIPAndFailClosed(t *testing.T) {
	installBackendTest(t)
	c, _ := backendTestContext("::ffff:192.0.2.4", "GET", "/dashboard/", "")
	require.Equal(t, "192.0.2.4", backendClientIP(c))
	c.Set(model.CtxKeyRealIPStr, "")
	c.Request.RemoteAddr = "192.0.2.5:443"
	c.Request.Header.Set("X-Forwarded-For", "198.51.100.99")
	require.Equal(t, "192.0.2.5", backendClientIP(c))
	singleton.DB = nil
	require.False(t, checkBackendAccess(c, currentBackendAccessConfig(), "/dashboard/"))
	require.Equal(t, 503, c.Writer.Status())
	singleton.Conf.BackendPasswordHash = ""
	require.True(t, checkBackendAccess(c, currentBackendAccessConfig(), "/dashboard/"))
}
func TestBackendPasswordConcurrentThreshold(t *testing.T) {
	installBackendTest(t)
	singleton.Conf.BackendPasswordFailures = 2
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for range 2 {
		wg.Add(1)
		go func() { defer wg.Done(); codes <- postBackendTest("192.0.2.8", "bad").Code }()
	}
	wg.Wait()
	close(codes)
	actual := []int{}
	for c := range codes {
		actual = append(actual, c)
	}
	require.ElementsMatch(t, []int{401, 429}, actual)
}
func TestBackendPasswordPageParityAndRedirect(t *testing.T) {
	installBackendTest(t)
	for _, bad := range []string{"https://evil.invalid", "//evil.invalid", "/api/v1/server", "/dashboard/\\evil", "/dashboard/\nfoo"} {
		require.Equal(t, "/dashboard/", sanitizeBackendNext(bad))
	}
	require.Equal(t, "/dashboard/profile?tab=1", sanitizeBackendNext("/dashboard/profile?tab=1"))
	front, fw := backendTestContext("192.0.2.1", "GET", "/", "")
	serveFrontendPasswordPage(front, "/", "", 401)
	back, bw := backendTestContext("192.0.2.1", "GET", "/dashboard/", "")
	checkBackendAccess(back, currentBackendAccessConfig(), "/dashboard/")
	style := regexp.MustCompile("(?s)<style>(.*?)</style>")
	require.Equal(t, style.FindString(fw.Body.String()), style.FindString(bw.Body.String()))
	require.Contains(t, fw.Body.String(), "前台访问密码")
	require.Contains(t, bw.Body.String(), "后台访问密码")
	require.NotContains(t, bw.Body.String(), "验证通过后，仍需使用原有账号登录后台。")
	require.NotContains(t, bw.Body.String(), "连续输错")
	require.NotContains(t, bw.Body.String(), "access-hint")
	require.Contains(t, bw.Body.String(), "继续登录")
	require.Contains(t, bw.Body.String(), `name="csrf"`)
	require.Equal(t, "no-store", bw.Header().Get("Cache-Control"))
}
func TestAccessPasswordSettingsRoundTrip(t *testing.T) {
	installBackendTest(t)
	path := filepath.Join(t.TempDir(), "config.yaml")
	require.NoError(t, os.WriteFile(path, []byte("jwt_secret_key: keep-key\nagent_secret_key: keep-agent\nsite_name: Keep site\nuser_template: user-dist\n"), 0600))
	config := &model.Config{}
	templates := []model.FrontendTemplate{{Path: "user-dist"}}
	require.NoError(t, config.Read(path, templates))
	singleton.Conf = &singleton.ConfigClass{Config: config}
	c, w := backendTestContext("192.0.2.1", "PATCH", "/api/v1/setting/access-passwords", `{"frontend_password":"front-fixture","backend_password":"back-fixture","backend_password_failures":2,"backend_password_ban_minutes":7}`)
	c.Request.Header.Set("Content-Type", "application/json")
	result, err := updateAccessPasswordSettings(c)
	require.NoError(t, err)
	require.Equal(t, accessPasswordSettings{FrontendRequired: true, BackendRequired: true, Failures: 2, BanMinutes: 7, FrontendSchedule: (model.AccessPasswordSchedule{}).WithDefaults(), BackendSchedule: (model.AccessPasswordSchedule{}).WithDefaults()}, result)
	require.Len(t, w.Result().Cookies(), 1)
	require.NoError(t, bcrypt.CompareHashAndPassword([]byte(config.BackendPasswordHash), []byte("back-fixture")))
	oldFront, oldBack := config.FrontendPasswordHash, config.BackendPasswordHash
	reloaded := &model.Config{}
	require.NoError(t, reloaded.Read(path, templates))
	require.Equal(t, oldBack, reloaded.BackendPasswordHash)
	require.Equal(t, 2, reloaded.BackendPasswordFailures)
	require.Equal(t, 7, reloaded.BackendPasswordBanMinutes)
	raw, err := json.Marshal(config)
	require.NoError(t, err)
	require.NotContains(t, string(raw), oldBack)
	require.NotContains(t, string(raw), oldFront)
	for _, body := range []string{`{}`, `{"backend_password_failures":0}`, `{"backend_password_ban_minutes":10081}`, `{"frontend_password":"x","clear_frontend_password":true}`, `{"site_name":"hijack"}`, `{"backend_password":"x"} {}`} {
		_, err = updateAccessPasswordSettings(displayContext("PATCH", body))
		require.Error(t, err)
		require.Equal(t, oldFront, config.FrontendPasswordHash)
		require.Equal(t, oldBack, config.BackendPasswordHash)
	}
	_, err = updateAccessPasswordSettings(displayContext("PATCH", `{"frontend_password":"","backend_password":""}`))
	require.NoError(t, err)
	require.Equal(t, oldFront, config.FrontendPasswordHash)
	require.Equal(t, oldBack, config.BackendPasswordHash)
	require.Equal(t, "Keep site", config.SiteName)
	require.Equal(t, "keep-key", config.JWTSecretKey)
	require.Equal(t, "keep-agent", config.AgentSecretKey)
	require.NoError(t, os.Remove(path))
	require.NoError(t, os.Mkdir(path, 0700))
	_, err = updateAccessPasswordSettings(displayContext("PATCH", `{"clear_frontend_password":true,"clear_backend_password":true,"backend_password_failures":9}`))
	require.Error(t, err)
	require.Equal(t, oldFront, config.FrontendPasswordHash)
	require.Equal(t, oldBack, config.BackendPasswordHash)
	require.Equal(t, 2, config.BackendPasswordFailures)
}

func TestBackendPasswordGateScopeAndPrivilege(t *testing.T) {
	installBackendTest(t)
	for _, tc := range []struct {
		name, path, method string
		pat, rawBearer     bool
		want               int
	}{
		{"browser management", "/api/v1/server", "GET", false, false, 403},
		{"forged bearer", "/api/v1/server", "GET", false, true, 403},
		{"authenticated PAT", "/api/v1/server", "GET", true, false, 204},
		{"public identity", "/api/v1/profile", "GET", false, false, 204},
		{"public refresh", "/api/v1/refresh-token", "POST", false, false, 204},
		{"profile modification", "/api/v1/profile", "POST", false, false, 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			router := gin.New()
			router.Use(func(c *gin.Context) {
				c.Set(model.CtxKeyRealIPStr, "192.0.2.1")
				c.Set(model.CtxKeyAuthorizedUser, &model.User{Role: model.RoleAdmin})
				if tc.pat {
					c.Set(apiTokenCtxKey, &model.APIToken{})
				}
				c.Next()
			})
			router.Handle(tc.method, tc.path, backendPasswordGate(), func(c *gin.Context) { c.Status(204) })
			w := httptest.NewRecorder()
			r := httptest.NewRequest(tc.method, tc.path, nil)
			if tc.rawBearer {
				r.Header.Set("Authorization", "Bearer forged")
			}
			router.ServeHTTP(w, r)
			require.Equal(t, tc.want, w.Code)
		})
	}
	for _, user := range []*model.User{nil, {Role: model.RoleMember}} {
		r := gin.New()
		r.Use(func(c *gin.Context) {
			if user != nil {
				c.Set(model.CtxKeyAuthorizedUser, user)
			}
			c.Next()
		})
		r.GET("/settings", adminHandler(getAccessPasswordSettings))
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("GET", "/settings", nil))
		var result model.CommonResponse[any]
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
		require.False(t, result.Success)
	}
}

// Opt-in loopback-only browser fixture. Never used with production state.
func TestAccessBrowserFixture(t *testing.T) {
	if os.Getenv("NEZHA_ACCESS_BROWSER_FIXTURE") != "1" {
		t.Skip("opt-in browser fixture")
	}
	installBackendTest(t)
	router := gin.New()
	router.Use(func(c *gin.Context) { c.Set(model.CtxKeyRealIPStr, "127.0.0.1"); c.Next() })
	router.POST("/api/v1/backend-auth", backendPasswordLogin)
	router.POST("/api/v1/frontend-auth", frontendPasswordLogin)
	router.GET("/", func(c *gin.Context) {
		if validFrontendPasswordCookie(c) {
			c.Data(200, "text/html; charset=utf-8", []byte("<h1>监控前台</h1>"))
			return
		}
		serveFrontendPasswordPage(c, "/", "", 200)
	})
	router.GET("/dashboard/", func(c *gin.Context) {
		if checkBackendAccess(c, currentBackendAccessConfig(), "/dashboard/") {
			c.Data(200, "text/html; charset=utf-8", []byte("<h1>账号登录</h1><label>账号<input></label><label>账号密码<input type=password></label>"))
		}
	})
	server := &http.Server{Addr: "127.0.0.1:5179", Handler: router, ReadHeaderTimeout: 5 * time.Second}
	go func() { _ = server.ListenAndServe() }()
	defer server.Close()
	ready := os.Getenv("NEZHA_ACCESS_BROWSER_READY")
	require.NotEmpty(t, ready)
	require.NoError(t, os.WriteFile(ready, []byte("ready"), 0600))
	deadline := time.After(12 * time.Minute)
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-deadline:
			return
		case <-ticker.C:
			if _, err := os.Stat(ready + ".stop"); err == nil {
				return
			}
		}
	}
}

func TestBackendConfigRequiresUnlockedBrowser(t *testing.T) {
	installBackendTest(t)
	singleton.Conf.DashboardHost = "private-admin.invalid"
	c, _ := backendTestContext("192.0.2.1", "GET", "/api/v1/setting", "")
	c.Set(model.CtxKeyAuthorizedUser, &model.User{Role: model.RoleAdmin})
	response, err := listConfig(c)
	require.NoError(t, err)
	require.Empty(t, response.Config.DashboardHost)
	c.Request.AddCookie(&http.Cookie{Name: backendPasswordCookie, Value: issueBackendToken(c, currentBackendAccessConfig(), "access", 8*time.Hour)})
	response, err = listConfig(c)
	require.NoError(t, err)
	require.Equal(t, "private-admin.invalid", response.Config.DashboardHost)
	require.Equal(t, 429, postBackendTest("192.0.2.1", "bad").Code)
	response, err = listConfig(c)
	require.NoError(t, err)
	require.Empty(t, response.Config.DashboardHost)
	c.Set(apiTokenCtxKey, &model.APIToken{})
	response, err = listConfig(c)
	require.NoError(t, err)
	require.Equal(t, "private-admin.invalid", response.Config.DashboardHost)
}

func TestBackendLockedPublicProfileRedactsInstallationCredentials(t *testing.T) {
	installBackendTest(t)
	require.NoError(t, singleton.DB.AutoMigrate(&model.Oauth2Bind{}))
	c, _ := backendTestContext("192.0.2.1", "GET", "/api/v1/profile", "")
	user := &model.User{Common: model.Common{ID: 7}, Username: "fixture", Role: model.RoleAdmin, AgentSecret: "private-install-fixture"}
	c.Set(model.CtxKeyAuthorizedUser, user)
	public, err := getProfile(c)
	require.NoError(t, err)
	require.Equal(t, user.ID, public.ID)
	require.Equal(t, user.Username, public.Username)
	require.Empty(t, public.AgentSecret)
	require.Empty(t, public.Oauth2Bind)
	require.Equal(t, "private-install-fixture", user.AgentSecret, "redaction must not mutate the cached account")
	c.Request.AddCookie(&http.Cookie{Name: backendPasswordCookie, Value: issueBackendToken(c, currentBackendAccessConfig(), "access", 8*time.Hour)})
	private, err := getProfile(c)
	require.NoError(t, err)
	require.Equal(t, user.AgentSecret, private.AgentSecret)
	require.Equal(t, 429, postBackendTest("192.0.2.1", "bad").Code)
	blocked, err := getProfile(c)
	require.NoError(t, err)
	require.Empty(t, blocked.AgentSecret)
}
