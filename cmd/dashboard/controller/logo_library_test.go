package controller

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/logoasset"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"net/http/httptest"
	"strings"
	"testing"
)

func libraryContext(method, path, body string) *gin.Context {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(method, path, strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Params = gin.Params{{Key: "id", Value: "provider-test"}}
	return c
}
func TestLibraryUpdateAndDeleteKeepSnapshot(t *testing.T) {
	cleanup, _ := setupMCPTest(t)
	defer cleanup()
	t.Chdir(t.TempDir())
	require.NoError(t, singleton.DB.AutoMigrate(&model.LogoLibraryEntry{}))
	src, e := logoasset.Put(logoDirectory, "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=")
	require.NoError(t, e)
	entry := model.LogoLibraryEntry{ID: "provider-test", Kind: "provider", Name: "原厂商", Version: 1, Logo: src, Regions: []string{}}
	require.NoError(t, singleton.DB.Create(&entry).Error)
	server := model.Server{Common: model.Common{ID: 7}, Name: "服务器", Note: "private", PublicNote: `{"keep":9007199254740993,"planDataMod":{"trafficVol":"500G/月","providerLogo":{"logoLibraryId":"provider-test","logo":"old"}}}`}
	require.NoError(t, singleton.DB.Create(&server).Error)
	entry.Name = "改名厂商"
	entry.LogoOriginal = src
	body, _ := json.Marshal(entry)
	result, e := updateLogoLibrary(libraryContext("PUT", "/logo/library/provider-test", string(body)))
	require.NoError(t, e)
	require.Equal(t, 1, result.(gin.H)["updated_servers"])
	var updated model.Server
	require.NoError(t, singleton.DB.First(&updated, 7).Error)
	require.Contains(t, updated.PublicNote, "改名厂商")
	require.Contains(t, updated.PublicNote, "9007199254740993")
	require.Contains(t, updated.PublicNote, "500G/月")
	require.Equal(t, "private", updated.Note)
	cached, _ := singleton.ServerShared.Get(7)
	require.Equal(t, updated.PublicNote, cached.PublicNote)
	_, e = updateLogoLibrary(libraryContext("PUT", "/logo/library/provider-test", string(body)))
	require.ErrorContains(t, e, "已被修改")
	result, e = deleteLogoLibrary(libraryContext("DELETE", "/logo/library/provider-test?version=2", ""))
	require.NoError(t, e)
	require.Equal(t, 1, result.(gin.H)["updated_servers"])
	require.NoError(t, singleton.DB.First(&updated, 7).Error)
	require.NotContains(t, updated.PublicNote, "logoLibraryId")
	require.Contains(t, updated.PublicNote, src)
	require.Contains(t, updated.PublicNote, "改名厂商")
	rows, e := listLogoLibrary(libraryContext("GET", "/logo/library", ""))
	require.NoError(t, e)
	require.Empty(t, rows)
}
func TestLibrarySaveResolvesLatest(t *testing.T) {
	cleanup, _ := setupMCPTest(t)
	defer cleanup()
	require.NoError(t, singleton.DB.AutoMigrate(&model.LogoLibraryEntry{}))
	require.NoError(t, singleton.DB.Create(&model.LogoLibraryEntry{ID: "provider-test", Name: "新名称", Logo: "latest"}).Error)
	n, e := resolveLogoLibrary(`{"套餐信息":{"厂商图标":{"图标库ID":"provider-test","Logo地址":"old"}}}`)
	require.NoError(t, e)
	require.Contains(t, n, `"Logo地址":"latest"`)
	require.Contains(t, n, `"图标名称":"新名称"`)
}
func TestLibraryCRUDAdminOnly(t *testing.T) {
	cleanup, _ := setupMCPTest(t)
	defer cleanup()
	for _, role := range []model.Role{model.RoleMember, model.RoleAdmin} {
		for _, method := range []string{"POST", "PUT", "DELETE"} {
			called := false
			r := gin.New()
			r.Handle(method, "/library", func(c *gin.Context) { c.Set(model.CtxKeyAuthorizedUser, &model.User{Role: role}) }, adminHandler(func(c *gin.Context) (any, error) { called = true; return nil, nil }))
			w := httptest.NewRecorder()
			r.ServeHTTP(w, httptest.NewRequest(method, "/library", nil))
			require.Equal(t, role == model.RoleAdmin, called)
		}
	}
}
