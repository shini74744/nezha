package controller

import (
	"encoding/json"
	"errors"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
)

func TestAppearanceScopesIsolateWritesAndRevisions(t *testing.T) {
	conf := &model.Config{ConfigForGuests: model.ConfigForGuests{AppearanceConfig: "default-original", CustomCode: "legacy", DashboardAppearanceConfig: "admin-original"}, ConfigDashboard: model.ConfigDashboard{AppearanceLegacyCode: "archive", UserTemplate: "user-dist"}}
	defaultRevision := appearanceRevision(conf.AppearanceConfig, conf.CustomCode)
	doraForm := appearanceForm{Revision: appearanceRevision("", "")}
	saves := 0
	save := func() error { saves++; return nil }
	require.NoError(t, saveThemeAppearance(conf, "doraemon-dist", doraForm, defaultDoraemonAppearance, save))
	require.Equal(t, "default-original", conf.AppearanceConfig)
	require.Equal(t, "legacy", conf.CustomCode)
	require.Equal(t, "archive", conf.AppearanceLegacyCode)
	require.Equal(t, "admin-original", conf.DashboardAppearanceConfig)
	require.Equal(t, "user-dist", conf.UserTemplate)
	require.Equal(t, defaultRevision, appearanceRevision(conf.AppearanceConfig, conf.CustomCode))
	require.NoError(t, saveThemeAppearance(conf, "user-dist", appearanceForm{Revision: defaultRevision}, "default-next", save))
	require.Equal(t, defaultDoraemonAppearance, conf.DoraemonAppearanceConfig)
	require.Error(t, saveThemeAppearance(conf, "doraemon-dist", doraForm, "stale", save))
	require.Equal(t, 2, saves)
	form := appearanceForm{Revision: appearanceRevision(conf.DoraemonAppearanceConfig, "")}
	require.Error(t, saveThemeAppearance(conf, "doraemon-dist", form, "failure", func() error { return errors.New("disk full") }))
	require.Equal(t, defaultDoraemonAppearance, conf.DoraemonAppearanceConfig)
	require.NoError(t, saveThemeAppearance(conf, "doraemon-dist", form, defaultDoraemonAppearance, func() error { t.Fatal("no-op save"); return nil }))
	code := ""
	form.ExpectedCustomCode = &code
	form.RemainingCustomCode = &code
	require.Error(t, saveThemeAppearance(conf, "doraemon-dist", form, "bad", save))
	require.Error(t, saveThemeAppearance(conf, "unknown", form, "bad", save))
}

func TestAppearanceScopesValidateDoraemonOnly(t *testing.T) {
	_, err := validateThemeAppearance("doraemon-dist", []byte(defaultDoraemonAppearance))
	require.NoError(t, err)
	for _, raw := range []string{
		`{"version":1,"enabled":false,"features":{}}`,
		`{"version":1,"enabled":true,"features":{"traffic":{"enabled":true}}}`,
		`{"version":1,"enabled":true,"features":{"traffic":{"enabled":true,"toggleInterval":999}}}`,
		`{"version":1,"enabled":true,"features":{"traffic":{"enabled":true,"toggleInterval":60001}}}`,
		`{"version":1,"enabled":true,"features":{"traffic":{"enabled":true,"toggleInterval":5000},"dark":{"enabled":true}}}`,
	} {
		_, err := validateThemeAppearance("doraemon-dist", []byte(raw))
		require.Error(t, err, raw)
	}
	_, err = validateThemeAppearance("unknown", []byte(defaultDoraemonAppearance))
	require.Error(t, err)
}

func TestAppearanceScopesRoutesAndPersistence(t *testing.T) {
	previous := singleton.Conf
	defer func() { singleton.Conf = previous }()
	file := filepath.Join(t.TempDir(), "config.yaml")
	require.NoError(t, os.WriteFile(file, []byte("jwt_secret_key: test-key\nagent_secret_key: test-agent\nuser_template: user-dist\n"), 0600))
	conf := &model.Config{}
	templates := []model.FrontendTemplate{{Path: "user-dist"}, {Path: "doraemon-dist"}}
	require.NoError(t, conf.Read(file, templates))
	conf.AppearanceConfig = `{"version":1,"enabled":false,"features":{}}`
	conf.CustomCode = "keep-default-code"
	conf.AppearanceLegacyCode = "keep-archive"
	require.NoError(t, conf.Save())
	singleton.Conf = &singleton.ConfigClass{Config: conf}
	ctx := func(method, url, body string) *gin.Context {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(method, url, strings.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
		return c
	}
	state, err := getAppearance(ctx("GET", "/api/v1/setting/appearance?theme=doraemon-dist", ""))
	require.NoError(t, err)
	dora := state.(map[string]any)
	require.Empty(t, dora["custom_code"])
	require.Equal(t, defaultDoraemonAppearance, string(dora["config"].(json.RawMessage)))
	disabled := strings.Replace(defaultDoraemonAppearance, `"enabled":true`, `"enabled":false`, 1)
	body, _ := json.Marshal(map[string]any{"revision": dora["revision"], "config": json.RawMessage(disabled)})
	_, err = updateAppearance(ctx("PATCH", "/api/v1/setting/appearance?theme=doraemon-dist", string(body)))
	require.NoError(t, err)
	require.Equal(t, "user-dist", conf.UserTemplate)
	require.Equal(t, `{"version":1,"enabled":false,"features":{}}`, conf.AppearanceConfig)
	require.Equal(t, "keep-default-code", conf.CustomCode)
	require.Equal(t, "keep-archive", conf.AppearanceLegacyCode)
	reloaded := &model.Config{}
	require.NoError(t, reloaded.Read(file, templates))
	require.Equal(t, conf.DoraemonAppearanceConfig, reloaded.DoraemonAppearanceConfig)
	require.Equal(t, conf.AppearanceConfig, reloaded.AppearanceConfig)
	for _, theme := range []string{"", "user-dist", "doraemon-dist", "another-theme"} {
		conf.UserTemplate = theme
		response, err := listConfig(ctx("GET", "/api/v1/setting", ""))
		require.NoError(t, err)
		if theme == "doraemon-dist" {
			require.Equal(t, conf.DoraemonAppearanceConfig, response.Config.DoraemonAppearanceConfig)
			require.Empty(t, response.Config.AppearanceConfig)
		} else {
			require.Empty(t, response.Config.DoraemonAppearanceConfig)
		}
	}
	_, err = getAppearance(ctx("GET", "/api/v1/setting/appearance?theme=unknown", ""))
	require.Error(t, err)
	_, err = updateAppearance(ctx("PATCH", "/api/v1/setting/appearance?theme=unknown", string(body)))
	require.Error(t, err)
}

func TestDoraemonVisualFlagsRemainScoped(t *testing.T) {
	keys := []string{"friendsBanner", "friendsInteraction", "gadgetDecorations", "backToTop", "speedColor", "speedAnimation", "cardGadgets"}
	for _, key := range keys {
		raw := `{"version":1,"enabled":true,"features":{"traffic":{"enabled":false,"toggleInterval":8000},"` + key + `":{"enabled":false}}}`
		normalized, err := validateThemeAppearance("doraemon-dist", []byte(raw))
		require.NoError(t, err)
		require.Contains(t, normalized, `"`+key+`":{"enabled":false}`)
		require.Contains(t, normalized, `"traffic":{"enabled":false,"toggleInterval":8000}`)
		_, err = validateThemeAppearance("user-dist", []byte(raw))
		require.Error(t, err)
		for _, bad := range []string{`{"enabled":"true"}`, `{"enabled":true,"count":3}`, `{}`, `null`} {
			invalid := strings.Replace(raw, `"`+key+`":{"enabled":false}`, `"`+key+`":`+bad, 1)
			_, err = validateThemeAppearance("doraemon-dist", []byte(invalid))
			require.Error(t, err, invalid)
		}
	}
	for _, raw := range []string{
		`{"version":1,"features":{"traffic":{"enabled":true,"toggleInterval":5000},"friendsBanner":{"enabled":true}}}`,
		`{"version":1,"enabled":true,"extra":1,"features":{"traffic":{"enabled":true,"toggleInterval":5000}}}`,
		defaultDoraemonAppearance + `{}`,
	} {
		_, err := validateThemeAppearance("doraemon-dist", []byte(raw))
		require.Error(t, err)
	}
}
