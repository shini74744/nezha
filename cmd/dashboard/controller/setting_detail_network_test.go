package controller

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/i18n"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
)

func TestDetailNetworkSettingRoundTrip(t *testing.T) {
	previousLocalizer := singleton.Localizer
	singleton.Localizer = i18n.NewLocalizer("zh_CN", "nezha", "translations", i18n.Translations)
	t.Cleanup(func() { singleton.Localizer = previousLocalizer })
	previous, templates := singleton.Conf, singleton.FrontendTemplates
	t.Cleanup(func() { singleton.Conf = previous; singleton.FrontendTemplates = templates })
	file := filepath.Join(t.TempDir(), "config.yaml")
	require.NoError(t, os.WriteFile(file, []byte("jwt_secret_key: test-key\nagent_secret_key: test-agent\nuser_template: user-dist\n"), 0600))
	singleton.FrontendTemplates = []model.FrontendTemplate{{Path: "user-dist"}, {Path: "doraemon-dist"}}
	conf := &model.Config{}
	require.NoError(t, conf.Read(file, singleton.FrontendTemplates))
	singleton.Conf = &singleton.ConfigClass{Config: conf}
	require.False(t, conf.ShowNetworkInDetail)
	ctx := func(method, body string) *gin.Context {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(method, "/api/v1/setting", strings.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
		return c
	}
	for _, step := range []struct {
		value string
		want  bool
	}{
		{",\"show_network_in_detail\":true", true}, {"", true}, {",\"show_network_in_detail\":false", false}, {"", false},
	} {
		_, err := updateConfig(ctx("PATCH", "{\"user_template\":\"user-dist\",\"language\":\"zh-CN\",\"site_name\":\"Test\""+step.value+"}"))
		require.NoError(t, err)
		require.Equal(t, step.want, conf.ShowNetworkInDetail)
		reloaded := &model.Config{}
		require.NoError(t, reloaded.Read(file, singleton.FrontendTemplates))
		require.Equal(t, step.want, reloaded.ShowNetworkInDetail)
		for _, theme := range []string{"user-dist", "doraemon-dist"} {
			conf.UserTemplate = theme
			response, err := listConfig(ctx("GET", ""))
			require.NoError(t, err)
			require.Equal(t, step.want, response.Config.ShowNetworkInDetail)
			raw, err := json.Marshal(response.Config)
			require.NoError(t, err)
			var fields map[string]any
			require.NoError(t, json.Unmarshal(raw, &fields))
			require.Equal(t, step.want, fields["show_network_in_detail"])
		}
	}
	// A failed save must not change the effective switch.
	require.NoError(t, os.Remove(file))
	require.NoError(t, os.Mkdir(file, 0700))
	_, err := updateConfig(ctx("PATCH", "{\"user_template\":\"user-dist\",\"show_network_in_detail\":true}"))
	require.Error(t, err)
	require.False(t, conf.ShowNetworkInDetail)
}
