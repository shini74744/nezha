package controller

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	appearance "github.com/nezhahq/nezha/resource/appearance"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
)

func TestPaperThemeSettingsRemainIndependent(t *testing.T) {
	previous, templates := singleton.Conf, singleton.FrontendTemplates
	t.Cleanup(func() { singleton.Conf = previous; singleton.FrontendTemplates = templates })
	require.NoError(t, singleton.InitFrontendTemplates())
	found := false
	for _, v := range singleton.FrontendTemplates {
		if v.Path == "paper-dist" {
			found = true
			require.False(t, v.IsAdmin)
			require.Equal(t, "纸间 · Paper", v.Name)
		}
	}
	require.True(t, found)
	singleton.Conf = &singleton.ConfigClass{Config: &model.Config{}}
	singleton.Conf.AppearanceConfig = "default-theme-preserved"
	singleton.Conf.DoraemonAppearanceConfig = "dora-theme-preserved"
	singleton.Conf.CustomCode = "legacy-code-preserved"
	singleton.Conf.UserTemplate = "paper-dist"
	for _, admin := range []bool{false, true} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		if admin {
			c.Set(model.CtxKeyAuthorizedUser, &model.User{Role: 0})
		}
		r, err := listConfig(c)
		require.NoError(t, err)
		require.JSONEq(t, string(appearance.PaperDefaults), r.Config.AppearanceConfig)
		require.Empty(t, r.Config.PaperAppearanceConfig)
		require.Empty(t, r.Config.DoraemonAppearanceConfig)
		require.Equal(t, "legacy-code-preserved", r.Config.CustomCode)
	}
	singleton.Conf.PaperAppearanceConfig = `{"version":1,"enabled":false,"features":{}}`
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	r, err := listConfig(c)
	require.NoError(t, err)
	require.Equal(t, singleton.Conf.PaperAppearanceConfig, r.Config.AppearanceConfig)
	singleton.Conf.UserTemplate = "user-dist"
	r, err = listConfig(c)
	require.NoError(t, err)
	require.Equal(t, "default-theme-preserved", r.Config.AppearanceConfig)
	require.Equal(t, "dora-theme-preserved", singleton.Conf.DoraemonAppearanceConfig)
}

func TestPaperThemeRoutesAndPasswordGate(t *testing.T) {
	t.Chdir(t.TempDir())
	previous := singleton.Conf
	t.Cleanup(func() { singleton.Conf = previous })
	singleton.Conf = &singleton.ConfigClass{Config: &model.Config{ConfigDashboard: model.ConfigDashboard{UserTemplate: "paper-dist", AdminTemplate: "admin-dist"}}}
	var dist fs.FS = fstest.MapFS{
		"paper-dist/index.html":      {Data: []byte("<html>Paper theme</html>")},
		"paper-dist/assets/theme.js": {Data: []byte("Paper asset")},
		"admin-dist/index.html":      {Data: []byte("<html>Original admin</html>")},
	}
	router := gin.New()
	router.NoRoute(fallbackToFrontend(dist))
	for path, want := range map[string]string{"/": "Paper theme", "/server/42": "Paper theme", "/assets/theme.js": "Paper asset", "/dashboard/": "Original admin"} {
		w := performFrontendFallbackRequest(t, router, path)
		require.Equal(t, http.StatusOK, w.Code, path)
		require.Contains(t, w.Body.String(), want, path)
	}
	for _, backend := range []bool{false, true} {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest("GET", "/", nil)
		serveAccessPasswordPage(c, accessPasswordPage{Paper: true, Backend: backend, Next: "/server/7", Site: "<script>unsafe</script>"}, 401)
		require.Equal(t, 401, w.Code)
		require.Contains(t, w.Body.String(), "&lt;script&gt;unsafe&lt;/script&gt;")
		require.NotContains(t, w.Body.String(), "<script>unsafe</script>")
		if backend {
			require.NotContains(t, w.Body.String(), `<body class="paper">`)
		} else {
			require.Contains(t, w.Body.String(), `<body class="paper">`)
			require.Contains(t, w.Body.String(), `action="/api/v1/frontend-auth"`)
			require.Contains(t, w.Body.String(), `value="/server/7"`)
		}
	}
}
