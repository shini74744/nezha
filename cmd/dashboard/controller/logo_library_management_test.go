package controller

import (
	"encoding/json"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLogoUsageOnlyReturnsPublicIdentityAndDeduplicates(t *testing.T) {
	cleanup, _ := setupMCPTest(t)
	defer cleanup()
	server := model.Server{Common: model.Common{ID: 44}, Name: "香港测试", Note: "never-return-private", PublicNote: `{"planDataMod":{"providerLogo":{"logoLibraryId":"a"},"networkRouteEntries":[{"logoLibraryId":"a"},{"图标库ID":"b"}]}}`}
	require.NoError(t, singleton.DB.Create(&server).Error)
	result, err := listLogoUsage(libraryContext("GET", "/logo/usage", ""))
	require.NoError(t, err)
	usage := result.(map[string][]logoUsageServer)
	require.Len(t, usage["a"], 1)
	require.Len(t, usage["b"], 1)
	payload, err := json.Marshal(result)
	require.NoError(t, err)
	require.JSONEq(t, `{"a":[{"id":44,"name":"香港测试"}],"b":[{"id":44,"name":"香港测试"}]}`, string(payload))
	require.NotContains(t, string(payload), "never-return-private")
}
func TestLogoBatchGroupAtomicConflictAndValidation(t *testing.T) {
	cleanup, _ := setupMCPTest(t)
	defer cleanup()
	require.NoError(t, singleton.DB.AutoMigrate(&model.LogoLibraryEntry{}, &model.LogoLibraryGroup{}))
	require.NoError(t, singleton.DB.Create(&model.LogoLibraryGroup{ID: "g", Name: "常用", Version: 1}).Error)
	for _, entry := range []model.LogoLibraryEntry{{ID: "a", Kind: "provider", Name: "A", Version: 1}, {ID: "b", Kind: "provider", Name: "B", Version: 2}, {ID: "c", Kind: "carrier", Name: "C", Version: 1}, {ID: "deleted", Kind: "provider", Name: "D", Version: 1, Deleted: true}} {
		require.NoError(t, singleton.DB.Create(&entry).Error)
	}
	for _, body := range []string{
		`{"group_id":"g","entries":[{"id":"a","version":1},{"id":"b","version":1}]}`,
		`{"group_id":"g","entries":[{"id":"a","version":1},{"id":"c","version":1}]}`,
		`{"group_id":"g","entries":[{"id":"a","version":1},{"id":"deleted","version":1}]}`,
		`{"group_id":"missing","entries":[{"id":"a","version":1}]}`,
		`{"group_id":"g","entries":[{"id":"a","version":1},{"id":"a","version":1}]}`,
		`{"group_id":"g","entries":[]}`,
		`{"group_id":"g","entries":[{"id":"a","version":0}]}`,
	} {
		_, err := batchGroupLogos(libraryContext("POST", "/logo/batch-group", body))
		require.Error(t, err)
		var first model.LogoLibraryEntry
		require.NoError(t, singleton.DB.First(&first, "id = ?", "a").Error)
		require.Empty(t, first.GroupID)
		require.Equal(t, uint64(1), first.Version)
	}
	snapshot := `{"planDataMod":{"providerLogo":{"logoLibraryId":"a","logo":"unchanged"}}}`
	require.NoError(t, singleton.DB.Create(&model.Server{Common: model.Common{ID: 45}, Name: "保持不变", PublicNote: snapshot}).Error)
	_, err := batchGroupLogos(libraryContext("POST", "/logo/batch-group", `{"group_id":"g","entries":[{"id":"a","version":1},{"id":"b","version":2}]}`))
	require.NoError(t, err)
	var first model.LogoLibraryEntry
	require.NoError(t, singleton.DB.First(&first, "id = ?", "a").Error)
	require.Equal(t, "g", first.GroupID)
	require.Equal(t, uint64(2), first.Version)
	var server model.Server
	require.NoError(t, singleton.DB.First(&server, 45).Error)
	require.Equal(t, snapshot, server.PublicNote)
	_, err = batchGroupLogos(libraryContext("POST", "/logo/batch-group", `{"group_id":"","entries":[{"id":"a","version":2}]}`))
	require.NoError(t, err)
	require.NoError(t, singleton.DB.First(&first, "id = ?", "a").Error)
	require.Empty(t, first.GroupID)
	entries := make([]string, 501)
	for i := range entries {
		entries[i] = fmt.Sprintf(`{"id":"%d","version":1}`, i)
	}
	_, err = batchGroupLogos(libraryContext("POST", "/logo/batch-group", `{"entries":[`+strings.Join(entries, ",")+`]}`))
	require.Error(t, err)
}
func TestLogoManagementEndpointsRequireAdmin(t *testing.T) {
	cleanup, _ := setupMCPTest(t)
	defer cleanup()
	for _, role := range []model.Role{model.RoleMember, model.RoleAdmin} {
		for _, method := range []string{"GET", "POST"} {
			called := false
			r := gin.New()
			r.Handle(method, "/management", func(c *gin.Context) { c.Set(model.CtxKeyAuthorizedUser, &model.User{Role: role}) }, adminHandler(func(c *gin.Context) (any, error) { called = true; return nil, nil }))
			w := httptest.NewRecorder()
			r.ServeHTTP(w, httptest.NewRequest(method, "/management", nil))
			require.Equal(t, role == model.RoleAdmin, called)
		}
	}
}
