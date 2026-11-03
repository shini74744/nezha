package controller

import (
	"bytes"
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"net/http/httptest"
	"testing"
)

func TestHomeNetworkAdminSaveOfflinePersistenceAndVisibility(t *testing.T) {
	_, restore := setupServerOwnershipFixture(t)
	defer restore()
	initial, _ := singleton.ServerShared.Get(1)
	initial.SetTaskStream(nil)
	request := func(admin bool, method, body string) map[string]any {
		r := gin.New()
		r.Use(func(c *gin.Context) {
			if admin {
				setAuthUser(c, 100, model.RoleAdmin)
			} else {
				setAuthUser(c, 100, model.RoleMember)
			}
		})
		r.GET("/server/:id", commonHandler(getHomeNetwork))
		r.PUT("/server/:id", commonHandler(setHomeNetwork))
		q := httptest.NewRequest(method, "/server/1", bytes.NewBufferString(body))
		q.Header.Set("Content-Type", "application/json")
		out := httptest.NewRecorder()
		r.ServeHTTP(out, q)
		var result map[string]any
		require.NoError(t, json.Unmarshal(out.Body.Bytes(), &result))
		return result
	}
	require.NotEqual(t, true, request(false, "PUT", `{"interfaces":["ens18"]}`)["success"])
	result := request(true, "PUT", `{"interfaces":["wg0","ens18","ens18"]}`)
	require.Equal(t, true, result["success"], result)
	s, _ := singleton.ServerShared.Get(1)
	require.Equal(t, []string{"ens18", "wg0"}, s.HomeNetworkNames())
	var stored model.Server
	require.NoError(t, singleton.DB.First(&stored, 1).Error)
	require.Equal(t, s.HomeNetworkNames(), stored.HomeNetworkNames())
	require.Nil(t, s.GetTaskStream()) // Saving display scope does not need/modify an Agent.
	require.Equal(t, true, request(true, "GET", "")["success"])
	require.NotEqual(t, true, request(true, "PUT", `{"interfaces":["bad\nname"]}`)["success"])
	visible := filterServersForViewer([]*model.Server{s}, 0, false, true, nil)
	require.Len(t, visible, 1)
	require.NotNil(t, visible[0].HomeNetwork)
	require.Empty(t, visible[0].HomeNetwork.Interfaces)
	require.Equal(t, true, request(true, "PUT", `{"interfaces":[]}`)["success"])
	s, _ = singleton.ServerShared.Get(1)
	require.Empty(t, s.HomeNetworkNames())
}
