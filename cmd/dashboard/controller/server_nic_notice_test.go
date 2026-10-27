package controller

import (
	"bytes"
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNICReminderPermissionAndStaleAcknowledgement(t *testing.T) {
	_, restore := setupServerOwnershipFixture(t)
	defer restore()
	require.NoError(t, singleton.DB.AutoMigrate(&model.ServerNICNotice{}))
	server, _ := singleton.ServerShared.Get(1)
	server.UUID = "machine-a"
	require.NoError(t, singleton.DB.Model(&model.Server{}).Where("id = ?", 1).Update("uuid", "machine-a").Error)
	require.NoError(t, singleton.PersistNICSelectionNotice("machine-a", "event-a"))
	request := func(user uint64, method, path, body string) map[string]any {
		router := gin.New()
		router.Use(func(c *gin.Context) { setAuthUser(c, user, model.RoleMember) })
		router.GET("/notices", commonHandler(listNICSelectionNotices))
		router.POST("/read/:id", commonHandler(acknowledgeNICSelectionNotice))
		req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		out := httptest.NewRecorder()
		router.ServeHTTP(out, req)
		var result map[string]any
		require.NoError(t, json.Unmarshal(out.Body.Bytes(), &result))
		return result
	}
	own := request(100, http.MethodGet, "/notices", "")
	require.Equal(t, true, own["success"])
	require.Equal(t, "event-a", own["data"].(map[string]any)["1"])
	foreign := request(200, http.MethodGet, "/notices", "")
	require.Empty(t, foreign["data"])
	foreign = request(200, http.MethodPost, "/read/1", `{"event_id":"event-a"}`)
	require.Empty(t, foreign["success"])
	require.NotEmpty(t, foreign["error"])
	require.NoError(t, singleton.PersistNICSelectionNotice("machine-a", "event-b"))
	stale := request(100, http.MethodPost, "/read/1", `{"event_id":"event-a"}`)
	require.Empty(t, stale["data"])
	own = request(100, http.MethodGet, "/notices", "")
	require.Equal(t, "event-b", own["data"].(map[string]any)["1"])
	read := request(100, http.MethodPost, "/read/1", `{"event_id":"event-b"}`)
	require.Equal(t, true, read["data"])
	own = request(100, http.MethodGet, "/notices", "")
	require.Empty(t, own["data"])
	require.Empty(t, request(100, http.MethodPost, "/read/1", `{}`)["success"])
}
