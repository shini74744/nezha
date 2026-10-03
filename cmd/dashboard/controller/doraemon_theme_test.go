package controller

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
)

func TestDoraemonThemeIsLastAndPreservesDefaultAppearance(t *testing.T) {
	previous, templates := singleton.Conf, singleton.FrontendTemplates
	t.Cleanup(func() { singleton.Conf = previous; singleton.FrontendTemplates = templates })
	require.NoError(t, singleton.InitFrontendTemplates())
	all := singleton.FrontendTemplates
	require.NotEmpty(t, all)
	require.Equal(t, "doraemon-dist", all[len(all)-1].Path)
	require.Equal(t, "哆啦 A 梦", all[len(all)-1].Name)
	require.False(t, all[len(all)-1].IsAdmin)
	singleton.Conf = &singleton.ConfigClass{Config: &model.Config{}}
	singleton.Conf.UserTemplate = "doraemon-dist"
	singleton.Conf.AppearanceConfig = "{\"version\":1,\"enabled\":true,\"features\":{}}"
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Set(model.CtxKeyAuthorizedUser, &model.User{Role: 0})
	response, err := listConfig(c)
	require.NoError(t, err)
	require.Empty(t, response.Config.AppearanceConfig)
	require.Contains(t, singleton.Conf.AppearanceConfig, "\"enabled\":true")
	require.Equal(t, "doraemon-dist", response.FrontendTemplates[len(response.FrontendTemplates)-1].Path)
	singleton.Conf.UserTemplate = "user-dist"
	response, err = listConfig(c)
	require.NoError(t, err)
	require.Equal(t, singleton.Conf.AppearanceConfig, response.Config.AppearanceConfig)
}
func TestDoraemonEmbeddedRoutesAndAssets(t *testing.T) {
	t.Chdir(t.TempDir())
	previous := singleton.Conf
	t.Cleanup(func() { singleton.Conf = previous })
	singleton.Conf = &singleton.ConfigClass{Config: &model.Config{ConfigDashboard: model.ConfigDashboard{UserTemplate: "doraemon-dist", AdminTemplate: "admin-dist"}}}
	var dist fs.FS = fstest.MapFS{
		"doraemon-dist/index.html":      {Data: []byte("<html>Doraemon theme</html>")},
		"doraemon-dist/assets/theme.js": {Data: []byte("Doraemon asset")},
		"admin-dist/index.html":         {Data: []byte("<html>Original admin</html>")},
	}
	r := gin.New()
	r.NoRoute(fallbackToFrontend(dist))
	for path, want := range map[string]string{"/": "Doraemon theme", "/server/42": "Doraemon theme", "/assets/theme.js": "Doraemon asset", "/dashboard/": "Original admin"} {
		w := performFrontendFallbackRequest(t, r, path)
		require.Equal(t, http.StatusOK, w.Code, path)
		require.Contains(t, w.Body.String(), want, path)
	}
}
