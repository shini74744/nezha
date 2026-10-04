package controller

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/i18n"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func displayContext(method, body string) *gin.Context {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(method, "/api/v1/setting/display", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	return c
}
func TestDisplaySettingIsolatedRoundTrip(t *testing.T) {
	previous := singleton.Conf
	t.Cleanup(func() { singleton.Conf = previous })
	file := filepath.Join(t.TempDir(), "config.yaml")
	require.NoError(t, os.WriteFile(file, []byte("jwt_secret_key: test-key\nagent_secret_key: test-agent\nuser_template: user-dist\nshow_network_in_detail: true\nsite_name: Keep site\ncustom_code: Keep code\n"), 0600))
	config := &model.Config{}
	templates := []model.FrontendTemplate{{Path: "user-dist"}}
	require.NoError(t, config.Read(file, templates))
	singleton.Conf = &singleton.ConfigClass{Config: config}
	oldConfig := *config
	value, err := getDisplaySettings(displayContext("GET", ""))
	require.NoError(t, err)
	require.Equal(t, displaySettings{true, false}, value) // Preserve the previous split statistics and combined network.
	for _, step := range []struct {
		body string
		want displaySettings
	}{
		{`{"statistics_split":false}`, displaySettings{false, false}},
		{`{"detail_network_split":true}`, displaySettings{false, true}},
		{`{"statistics_split":true}`, displaySettings{true, true}},
		{`{"statistics_split":false,"detail_network_split":false}`, displaySettings{false, false}},
	} {
		result, err := updateDisplaySettings(displayContext("PATCH", step.body))
		require.NoError(t, err)
		require.Equal(t, step.want, result)
		reloaded := &model.Config{}
		require.NoError(t, reloaded.Read(file, templates))
		require.Equal(t, step.want.StatisticsSplit, resolveOptionalBool(reloaded.StatisticsSplit, true))
		require.Equal(t, !step.want.DetailNetworkSplit, reloaded.ShowNetworkInDetail)
		next := *config
		next.ShowNetworkInDetail = oldConfig.ShowNetworkInDetail
		next.StatisticsSplit = oldConfig.StatisticsSplit
		require.Equal(t, oldConfig, next, "unrelated config must not change")
	}
	for _, body := range []string{`{}`, `{"statistics_split":null}`, `{"statistics_split":"true"}`, `{"statistics_split":true,"site_name":"changed"}`, `{"detail_network_split":true} {}`, strings.Repeat(" ", 300) + `{"statistics_split":true}`} {
		_, err := updateDisplaySettings(displayContext("PATCH", body))
		require.Error(t, err)
		require.Equal(t, displaySettings{false, false}, currentDisplaySettings())
	}
	require.NoError(t, os.Remove(file))
	require.NoError(t, os.Mkdir(file, 0700))
	_, err = updateDisplaySettings(displayContext("PATCH", `{"statistics_split":true,"detail_network_split":true}`))
	require.Error(t, err)
	require.Equal(t, displaySettings{false, false}, currentDisplaySettings())
}
func TestDisplaySettingAdminOnly(t *testing.T) {
	previous := singleton.Localizer
	singleton.Localizer = i18n.NewLocalizer("zh_CN", "nezha", "translations", i18n.Translations)
	t.Cleanup(func() { singleton.Localizer = previous })
	for _, user := range []*model.User{nil, {Role: model.RoleMember}} {
		for _, method := range []string{"GET", "PATCH"} {
			router := gin.New()
			router.Use(func(c *gin.Context) {
				if user != nil {
					c.Set(model.CtxKeyAuthorizedUser, user)
				}
				c.Next()
			})
			router.GET("/api/v1/setting/display", restScopeMiddleware(model.ScopeAdminAll), adminHandler(getDisplaySettings))
			router.PATCH("/api/v1/setting/display", restScopeMiddleware(model.ScopeAdminAll), adminHandler(updateDisplaySettings))
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, httptest.NewRequest(method, "/api/v1/setting/display", strings.NewReader(`{"statistics_split":false}`)))
			var result model.CommonResponse[any]
			require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &result))
			require.False(t, result.Success)
		}
	}
}
