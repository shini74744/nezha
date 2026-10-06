package controller

import (
	"errors"
	"fmt"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/connectivity"
	"github.com/nezhahq/nezha/service/rpc"
	"github.com/nezhahq/nezha/service/singleton"
)

var connectivityManager = connectivity.NewManager()

type connectivityResponse struct {
	connectivity.Snapshot
	ServerID uint64 `json:"server_id"`
	Online   bool   `json:"online"`
	CanRun   bool   `json:"can_run"`
}

func connectivityKey(server *model.Server) string {
	return fmt.Sprintf("%d:%s:%d", server.ID, server.UUID, server.GetUserID())
}
func canRunConnectivity(c *gin.Context, server *model.Server) bool {
	if !userCanViewServer(c, server) || !server.HasPermission(c) {
		return false
	}
	token := APITokenFromContext(c)
	return token == nil || token.HasScope(model.ScopeServiceWrite)
}
func connectivityServer(c *gin.Context) (*model.Server, error) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		return nil, errors.New("invalid server ID")
	}
	server, ok := singleton.ServerShared.Get(id)
	if !ok || !userCanViewServer(c, server) {
		return nil, errors.New("server not found")
	}
	return server, nil
}

// @Summary Read cached node-origin connectivity results
// @Description Read-only; never triggers probes. Follows server visibility and frontend password rules.
// @Tags common
// @Security BearerAuth
// @Param id path uint true "Server ID"
// @Success 200 {object} model.CommonResponse[connectivityResponse]
// @Router /server/{id}/connectivity [get]
func getConnectivity(c *gin.Context) (*connectivityResponse, error) {
	c.Header("Cache-Control", "no-store")
	server, err := connectivityServer(c)
	if err != nil {
		return nil, err
	}
	key := connectivityKey(server)
	targets, err := configuredConnectivityTargets()
	if err != nil {
		return nil, err
	}
	snapshot := connectivityManager.Get(key, targets)
	current, err := connectivityServer(c)
	if err != nil || connectivityKey(current) != key {
		return nil, errors.New("server changed; reload")
	}
	return &connectivityResponse{Snapshot: snapshot, ServerID: current.ID, Online: rpc.ConnectivityOnline(current), CanRun: canRunConnectivity(c, current)}, nil
}

// @Summary Start an administrator-configured connectivity test from this node
// @Description Owner/admin only, CSRF protected, deduplicated and rate limited. No browser-provided URLs or commands are accepted.
// @Tags auth required
// @Security BearerAuth
// @Param id path uint true "Server ID"
// @Success 200 {object} model.CommonResponse[connectivityResponse]
// @Router /server/{id}/connectivity [post]
func startConnectivity(c *gin.Context) (*connectivityResponse, error) {
	c.Header("Cache-Control", "no-store")
	server, err := connectivityServer(c)
	if err != nil {
		return nil, err
	}
	key := connectivityKey(server)
	if !canRunConnectivity(c, server) {
		return nil, errors.New("permission denied")
	}
	// No input schema: reject bodies/query params instead of silently accepting a URL.
	if c.Request.ContentLength != 0 || len(c.Request.TransferEncoding) > 0 || c.Request.URL.RawQuery != "" {
		return nil, errors.New("connectivity accepts no target or request body")
	}
	if !rpc.ConnectivityOnline(server) {
		return nil, errors.New("connectivity_offline")
	}
	targets, err := configuredConnectivityTargets()
	if err != nil {
		return nil, err
	}
	probe := rpc.ConnectivityProbe(server, targets)
	current, err := connectivityServer(c)
	if err != nil || connectivityKey(current) != key || !canRunConnectivity(c, current) {
		return nil, errors.New("server changed; reload")
	}
	_, err = connectivityManager.Start(key, probe, targets)
	if err != nil {
		return nil, err
	}
	return getConnectivity(c)
}
