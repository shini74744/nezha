package controller

import (
	"net/http"
	"strings"
	"testing"
)

func TestSettingsLayoutRoutesServeFrontendOnReload(t *testing.T) {
	t.Chdir(t.TempDir())
	router := newFrontendFallbackTestRouter(t)
	for _, suffix := range []string{"", "/user", "/online-user", "/waf", "/api-tokens", "/appearance", "/dashboard-appearance", "/icons"} {
		path := "/dashboard/settings" + suffix
		t.Run(path, func(t *testing.T) {
			response := performFrontendFallbackRequest(t, router, path)
			if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "admin index") {
				t.Fatalf("settings reload returned status %d; expected the admin frontend", response.Code)
			}
		})
	}
	response := performFrontendFallbackRequest(t, router, "/dashboard/settings/not-a-page")
	if response.Code != http.StatusNotFound {
		t.Fatalf("unregistered settings route returned %d, want 404", response.Code)
	}
}
