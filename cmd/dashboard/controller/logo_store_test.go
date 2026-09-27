package controller

import (
	"bytes"
	"encoding/base64"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/pkg/logoasset"
	"github.com/stretchr/testify/require"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLogoAssetServe(t *testing.T) {
	t.Chdir(t.TempDir())
	svg := []byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M0 0h16v16H0Z" fill="green"/></svg>`)
	src, e := logoasset.Put(logoDirectory, "data:image/svg+xml;base64,"+base64.StdEncoding.EncodeToString(svg))
	require.NoError(t, e)
	r := gin.New()
	r.GET("/api/v1/logo/assets/:name", serveLogoAsset)
	r.HEAD("/api/v1/logo/assets/:name", serveLogoAsset)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", src, nil))
	require.Equal(t, 200, w.Code)
	require.Equal(t, svg, w.Body.Bytes())
	require.Equal(t, "image/svg+xml", w.Header().Get("Content-Type"))
	require.Contains(t, w.Header().Get("Cache-Control"), "immutable")
	require.Contains(t, w.Header().Get("Content-Security-Policy"), "sandbox")
	require.Equal(t, "nosniff", w.Header().Get("X-Content-Type-Options"))
	q := httptest.NewRequest("GET", src, nil)
	q.Header.Set("If-None-Match", w.Header().Get("ETag"))
	w = httptest.NewRecorder()
	r.ServeHTTP(w, q)
	require.Equal(t, http.StatusNotModified, w.Code)
	for _, path := range []string{"/api/v1/logo/assets/config.yaml", "/api/v1/logo/assets/" + strings.Repeat("a", 64) + ".html"} {
		w = httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		require.Equal(t, 404, w.Code)
	}
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("HEAD", src, nil))
	require.Equal(t, 200, w.Code)
	require.Empty(t, w.Body.Bytes())
}
func TestLogoStoreOwnedResult(t *testing.T) {
	t.Chdir(t.TempDir())
	body := `{"logo":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII="}`
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/logo/store", bytes.NewBufferString(body))
	c.Request.Header.Set("Content-Type", "application/json")
	result, e := storeWebsiteLogo(c)
	require.NoError(t, e)
	require.True(t, strings.HasPrefix(result.(gin.H)["logo"].(string), logoasset.Prefix))
}
