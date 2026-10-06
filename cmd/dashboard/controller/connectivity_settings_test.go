package controller

import (
	"encoding/json"
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/connectivity"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestConnectivitySettingsSaveRollbackAndRevision(t *testing.T) {
	config := &model.Config{}
	config.SiteName = "preserve"
	config.AgentSecretKey = "preserve-agent"
	state, err := connectivityCatalogState("")
	require.NoError(t, err)
	items := state.Items
	items[0].Name = "changed"
	items[1].Enabled = false
	items[2], items[3] = items[3], items[2]
	form := connectivitySettingsForm{Revision: state.Revision, Items: items}
	_, err = saveConnectivitySettings(config, form, func() error { return errors.New("disk full") })
	require.Error(t, err)
	require.Empty(t, config.ConnectivityConfig)
	next, err := saveConnectivitySettings(config, form, func() error { return nil })
	require.NoError(t, err)
	require.Equal(t, items, next.Items)
	require.Equal(t, "preserve", config.SiteName)
	require.Equal(t, "preserve-agent", config.AgentSecretKey)
	_, err = saveConnectivitySettings(config, form, func() error { t.Fatal("stale save"); return nil })
	require.Error(t, err)
	next.Items = []connectivity.CatalogItem{}
	next, err = saveConnectivitySettings(config, connectivitySettingsForm{Revision: next.Revision, Items: next.Items}, func() error { return nil })
	require.NoError(t, err)
	require.Empty(t, next.Items)
	require.Len(t, next.Defaults, 72)
}
func TestConnectivitySettingsPersistenceAndPrivateURL(t *testing.T) {
	file := filepath.Join(t.TempDir(), "config.yaml")
	require.NoError(t, os.WriteFile(file, []byte("jwt_secret_key: fixture\nagent_secret_key: fixture\n"), 0600))
	conf := &model.Config{}
	require.NoError(t, conf.Read(file, nil))
	items := []connectivity.CatalogItem{{ID: "custom-test", Name: "Custom", Group: "global", URL: "https://example.com/private-path", Icon: "", Enabled: true}}
	_, err := saveConnectivitySettings(conf, connectivitySettingsForm{Revision: appearanceRevision("", "connectivity"), Items: items}, conf.Save)
	require.NoError(t, err)
	reloaded := &model.Config{}
	require.NoError(t, reloaded.Read(file, nil))
	require.Equal(t, conf.ConnectivityConfig, reloaded.ConnectivityConfig)
	old := singleton.Conf
	singleton.Conf = &singleton.ConfigClass{Config: reloaded}
	t.Cleanup(func() { singleton.Conf = old })
	targets, err := configuredConnectivityTargets()
	require.NoError(t, err)
	require.Len(t, targets, 1)
	raw, _ := json.Marshal(targets)
	require.NotContains(t, string(raw), "private-path")
	response, err := listConfig(newServerGroupCtx(nil))
	require.NoError(t, err)
	raw, _ = json.Marshal(response)
	require.NotContains(t, string(raw), "private-path")
	require.NotContains(t, string(raw), "connectivity_config")
}
func TestConnectivitySettingsAdminGuardAndStrictBody(t *testing.T) {
	setupServerGroupVisibilityFixture(t)
	old := singleton.Conf
	singleton.Conf = &singleton.ConfigClass{Config: &model.Config{}}
	t.Cleanup(func() { singleton.Conf = old })
	for _, user := range []*model.User{nil, {Role: model.RoleMember}} {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest("GET", "/api/v1/setting/connectivity", nil)
		if user != nil {
			c.Set(model.CtxKeyAuthorizedUser, user)
		}
		adminHandler(getConnectivitySettings)(c)
		var denied map[string]any
		require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &denied))
		require.NotEqual(t, true, denied["success"])
		require.NotEmpty(t, denied["error"])
		require.NotContains(t, recorder.Body.String(), "defaults")
	}
	for _, body := range []string{`{"revision":"x","items":[],"url":"https://example.com"}`, `{"revision":"x","items":[]}{}`, strings.Repeat("x", 385<<10)} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("PUT", "/api/v1/setting/connectivity", strings.NewReader(body))
		_, err := updateConnectivitySettings(c)
		require.Error(t, err)
		require.Empty(t, singleton.Conf.ConnectivityConfig)
	}
	source, err := os.ReadFile("controller.go")
	require.NoError(t, err)
	require.Contains(t, string(source), `auth.GET("/setting/connectivity", restScopeMiddleware(model.ScopeAdminAll), adminHandler(getConnectivitySettings))`)
	require.Contains(t, string(source), `auth.PUT("/setting/connectivity", restScopeMiddleware(model.ScopeAdminAll), adminHandler(updateConnectivitySettings))`)
}
