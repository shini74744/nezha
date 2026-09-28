package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"net/http/httptest"
	"testing"
)

func TestDisplayHiddenDoesNotBypassGuestPrivacy(t *testing.T) {
	servers := makeStreamTestServers()
	for _, s := range servers {
		s.HideForDisplay = true
	}
	guest := filterServersForViewer(servers, 0, false, true, nil)
	require.Len(t, guest, 2)
	for _, s := range guest {
		require.True(t, s.HideForDisplay)
		require.Empty(t, s.Host.Version)
	}
	require.Nil(t, findStreamServer(guest, 2))
	require.Nil(t, findStreamServer(guest, 4))
	admin := filterServersForViewer(servers, 1, true, true, nil)
	require.Len(t, admin, 4)
	owner := filterServersForViewer(servers, 100, false, true, nil)
	require.Len(t, owner, 3)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	require.True(t, userCanViewServer(ctx, servers[0]))
	require.False(t, userCanViewServer(ctx, servers[1]))
}
