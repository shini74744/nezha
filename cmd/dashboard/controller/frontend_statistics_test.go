package controller

import (
	"net/http"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
)

func TestStatisticsLauncherAllBundledThemes(t *testing.T) {
	t.Chdir(t.TempDir())
	previous := singleton.Conf
	t.Cleanup(func() { singleton.Conf = previous })
	templates := []string{"user-dist", "doraemon-dist", "nazhua-dist", "aobobo-dist", "nezha-pixel-dist", "nezha-ascii-dist"}
	for _, theme := range templates {
		t.Run(theme, func(t *testing.T) {
			singleton.Conf = &singleton.ConfigClass{Config: &model.Config{ConfigDashboard: model.ConfigDashboard{UserTemplate: theme, AdminTemplate: "admin-dist"}}}
			dist := fstest.MapFS{theme + "/index.html": {Data: []byte("<html><head></head><body>Theme</body></html>")}, "admin-dist/index.html": {Data: []byte("<html>Admin</html>")}}
			router := gin.New()
			router.NoRoute(fallbackToFrontend(dist))
			response := performFrontendFallbackRequest(t, router, "/")
			if response.Code != http.StatusOK {
				t.Fatalf("status %d", response.Code)
			}
			has := strings.Contains(response.Body.String(), "nezha-statistics-loader")
			if has != sharedStatisticsTheme(theme) {
				t.Fatalf("theme %s injected=%v", theme, has)
			}
			admin := performFrontendFallbackRequest(t, router, "/dashboard/")
			if strings.Contains(admin.Body.String(), "nezha-statistics-loader") {
				t.Fatal("admin must not be modified")
			}
			missing := performFrontendFallbackRequest(t, router, "/missing-route")
			if missing.Code != 404 || strings.Contains(missing.Body.String(), "nezha-statistics-loader") {
				t.Fatal("missing route must retain 404 without launcher")
			}
			script := performFrontendFallbackRequest(t, router, frontendStatisticsPath+"?v="+frontendStatisticsVersion)
			if script.Code != 200 || !strings.Contains(script.Header().Get("Content-Type"), "javascript") || script.Body.Len() != len(frontendStatisticsJS) {
				t.Fatal("shared asset not served")
			}
		})
	}
}

func TestStatisticsLauncherLocalOverrideAndEscaping(t *testing.T) {
	t.Chdir(t.TempDir())
	router := newFrontendFallbackTestRouter(t)
	singleton.Conf.UserTemplate = "nazhua-dist"
	writeFrontendFallbackTestFile(t, "nazhua-dist/index.html", "<html><HEAD></HEAD><body>Override</body></html>")
	response := performFrontendFallbackRequest(t, router, "/")
	if !strings.Contains(response.Body.String(), "Override") || strings.Count(response.Body.String(), "nezha-statistics-loader") != 1 {
		t.Fatal("local theme override not enhanced exactly once")
	}
	for _, name := range []string{"../data", "admin-dist", "user-dist", "doraemon-dist", "/bad-dist", ""} {
		if sharedStatisticsTheme(name) {
			t.Fatalf("unexpected theme %s", name)
		}
	}
}

func TestStatisticsScriptRespectsFrontendPassword(t *testing.T) {
	t.Chdir(t.TempDir())
	router := newFrontendFallbackTestRouter(t)
	installFrontendPasswordConfig(t, "test-password")
	response := performFrontendFallbackRequest(t, router, frontendStatisticsPath)
	if strings.Contains(response.Header().Get("Content-Type"), "javascript") ||
		strings.Contains(response.Body.String(), "Shadow DOM") {
		t.Fatal("statistics script must not bypass frontend password gate")
	}
}

func TestStatisticsLauncherHonorsGlobalSplit(t *testing.T) {
	t.Chdir(t.TempDir())
	router := newFrontendFallbackTestRouter(t)
	singleton.Conf.UserTemplate = "nazhua-dist"
	writeFrontendFallbackTestFile(t, "nazhua-dist/index.html", "<html><head></head><body>Theme</body></html>")
	for _, split := range []bool{false, true} {
		singleton.Conf.StatisticsSplit = &split
		response := performFrontendFallbackRequest(t, router, "/")
		want := `data-statistics-split="false"`
		if split {
			want = `data-statistics-split="true"`
		}
		if !strings.Contains(response.Body.String(), want) {
			t.Fatalf("missing split flag %s", want)
		}
	}
}
