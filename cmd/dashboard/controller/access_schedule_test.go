package controller

import (
	"encoding/json"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func freeAccessSchedule() model.AccessPasswordSchedule {
	now := time.Now().In(time.FixedZone("Beijing", 8*3600))
	return model.AccessPasswordSchedule{Enabled: true, Start: now.Add(6 * time.Hour).Format("15:04"), End: now.Add(7 * time.Hour).Format("15:04")}
}
func TestAccessScheduleFreeWindowAndNoCredential(t *testing.T) {
	installBackendTest(t)
	s := freeAccessSchedule()
	singleton.Conf.FrontendPasswordSchedule = s
	singleton.Conf.BackendPasswordSchedule = s
	require.False(t, frontendPasswordRequired())
	c, _ := backendTestContext("192.0.2.1", "GET", "/dashboard/", "")
	require.True(t, checkBackendAccess(c, currentBackendAccessConfig(), "/dashboard/"))
	back := postBackendTest("192.0.2.1", "incorrect")
	require.Equal(t, 303, back.Code)
	require.Empty(t, back.Result().Cookies(), "free window must not grant future access")
	front, fw := backendTestContext("192.0.2.1", "POST", "/api/v1/frontend-auth", `{"password":"incorrect"}`)
	front.Request.Header.Set("Content-Type", "application/json")
	frontendPasswordLogin(front)
	require.Equal(t, 200, fw.Code)
	require.Empty(t, fw.Result().Cookies())
	var count int64
	require.NoError(t, singleton.DB.Model(&model.BackendAccessAttempt{}).Count(&count).Error)
	require.Zero(t, count)
	// Switching into the protected period requires proof again, without restarting.
	singleton.Conf.FrontendPasswordSchedule.Enabled = false
	singleton.Conf.BackendPasswordSchedule.Enabled = false
	require.True(t, frontendPasswordRequired())
	c, _ = backendTestContext("192.0.2.1", "GET", "/dashboard/", "")
	require.False(t, checkBackendAccess(c, currentBackendAccessConfig(), "/dashboard/"))
	require.Equal(t, 403, c.Writer.Status())
	require.Equal(t, 303, postBackendTest("192.0.2.1", "fixture-backend").Code)
}
func TestAccessScheduleBanAndPrivateData(t *testing.T) {
	installBackendTest(t)
	require.NoError(t, singleton.DB.AutoMigrate(&model.Oauth2Bind{}))
	require.Equal(t, 429, postBackendTest("192.0.2.2", "incorrect").Code)
	singleton.Conf.BackendPasswordSchedule = freeAccessSchedule()
	singleton.Conf.FrontendPasswordSchedule = freeAccessSchedule()
	singleton.Conf.DashboardHost = "private.invalid"
	for _, ip := range []string{"192.0.2.1", "192.0.2.2"} {
		c, _ := backendTestContext(ip, "GET", "/api/v1/setting", "")
		c.Set(model.CtxKeyAuthorizedUser, &model.User{Role: model.RoleAdmin, AgentSecret: "fixture-private"})
		response, err := listConfig(c)
		require.NoError(t, err)
		require.False(t, response.Config.FrontendPasswordRequired)
		profile, err := getProfile(c)
		require.NoError(t, err)
		if ip == "192.0.2.1" {
			require.Equal(t, "private.invalid", response.Config.DashboardHost)
			require.Equal(t, "fixture-private", profile.AgentSecret)
		} else {
			require.Empty(t, response.Config.DashboardHost)
			require.Empty(t, profile.AgentSecret)
			require.False(t, checkBackendAccess(c, currentBackendAccessConfig(), "/dashboard/"))
			require.Equal(t, 429, c.Writer.Status())
			require.Equal(t, 429, postBackendTest(ip, "fixture-backend").Code)
		}
	}
}
func TestAccessScheduleSavePersistenceAndRollback(t *testing.T) {
	installBackendTest(t)
	path := filepath.Join(t.TempDir(), "config.yaml")
	require.NoError(t, os.WriteFile(path, []byte("jwt_secret_key: fixture-key\nsite_name: Keep\nuser_template: user-dist\n"), 0600))
	config := &model.Config{}
	templates := []model.FrontendTemplate{{Path: "user-dist"}}
	require.NoError(t, config.Read(path, templates))
	singleton.Conf = &singleton.ConfigClass{Config: config}
	result, err := updateAccessPasswordSettings(displayContext("PATCH", `{"frontend_password_schedule":{"enabled":true,"start":"22:00","end":"07:00"},"backend_password_schedule":{"enabled":true,"start":"08:00","end":"23:00"}}`))
	require.NoError(t, err)
	settings := result.(accessPasswordSettings)
	require.Equal(t, model.AccessPasswordSchedule{Enabled: true, Start: "22:00", End: "07:00"}, settings.FrontendSchedule)
	require.NotEqual(t, settings.FrontendSchedule, settings.BackendSchedule)
	require.False(t, frontendPasswordRequired(), "schedule alone must not enable an absent password")
	reloaded := &model.Config{}
	require.NoError(t, reloaded.Read(path, templates))
	require.Equal(t, config.FrontendPasswordSchedule, reloaded.FrontendPasswordSchedule)
	require.Equal(t, config.BackendPasswordSchedule, reloaded.BackendPasswordSchedule)
	raw, err := json.Marshal(config)
	require.NoError(t, err)
	require.NotContains(t, string(raw), "password_schedule", "private schedules must not leak into public config")
	old := *config
	for _, body := range []string{
		`{"frontend_password_schedule":{"enabled":true,"start":"08:00","end":"08:00"}}`,
		`{"backend_password_schedule":{"enabled":true,"start":"24:00","end":"07:00"}}`,
		`{"backend_password_schedule":{"enabled":true,"start":"08:00"}}`,
		`{"backend_password_schedule":{"enabled":true,"start":"08:00","end":"23:00","timezone":"arbitrary"}}`,
	} {
		_, err = updateAccessPasswordSettings(displayContext("PATCH", body))
		require.Error(t, err)
		require.Equal(t, old.FrontendPasswordSchedule, config.FrontendPasswordSchedule)
		require.Equal(t, old.BackendPasswordSchedule, config.BackendPasswordSchedule)
	}
	// Updating one side preserves the other, passwords and all unrelated config.
	_, err = updateAccessPasswordSettings(displayContext("PATCH", `{"frontend_password_schedule":{"enabled":false,"start":"22:00","end":"07:00"}}`))
	require.NoError(t, err)
	require.False(t, config.FrontendPasswordSchedule.Enabled)
	require.Equal(t, old.BackendPasswordSchedule, config.BackendPasswordSchedule)
	require.Equal(t, "Keep", config.SiteName)
	require.NoError(t, os.Remove(path))
	require.NoError(t, os.Mkdir(path, 0700))
	previous := config.FrontendPasswordSchedule
	_, err = updateAccessPasswordSettings(displayContext("PATCH", `{"frontend_password_schedule":{"enabled":true,"start":"09:00","end":"18:00"}}`))
	require.Error(t, err)
	require.Equal(t, previous, config.FrontendPasswordSchedule)
}
