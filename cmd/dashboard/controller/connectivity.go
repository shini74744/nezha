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
	LocalOnly bool `json:"local_only,omitempty"`
	connectivity.Snapshot
	FullBatch         bool                   `json:"full_batch"`
	CanBypassCooldown bool                   `json:"can_bypass_cooldown"`
	Latest            *connectivity.Snapshot `json:"latest,omitempty"`
	ServerID          uint64                 `json:"server_id"`
	Online            bool                   `json:"online"`
	CanRun            bool                   `json:"can_run"`
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
func connectivityServer(c *gin.Context, allowLocal ...bool) (*model.Server, error) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		return nil, errors.New("invalid server ID")
	}
	server, ok := singleton.ServerShared.Get(id)
	if !ok || !userCanViewServer(c, server) || (server.ConnectivityDisabled && !(len(allowLocal) > 0 && allowLocal[0] && server.ConnectivityLocalOnly)) {
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
	server, err := connectivityServer(c, true)
	if err != nil {
		return nil, err
	}
	key := connectivityKey(server)
	targets, err := configuredConnectivityTargets()
	if err != nil {
		return nil, err
	}
	if server.ConnectivityDisabled {
		return localConnectivityResponse(server, targets), nil
	}
	snapshot := connectivityCached(key, targets)
	current, err := connectivityServer(c, true)
	if err != nil || connectivityKey(current) != key {
		return nil, errors.New("server changed; reload")
	}
	if current.ConnectivityDisabled {
		return localConnectivityResponse(current, targets), nil
	}
	response := &connectivityResponse{Snapshot: snapshot, FullBatch: snapshot.Full, ServerID: current.ID, Online: rpc.ConnectivityOnline(current), CanRun: canRunConnectivity(c, current)}
	response.CanBypassCooldown = response.CanRun && callerIsAdmin(c)
	if snapshot.State == "running" {
		if latest, ok := connectivityManager.LatestCompleted(key, targets); ok {
			response.Latest = &latest
		}
	}
	return response, nil
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
	_ = connectivityCached(key, targets)
	probe := guardedConnectivityProbe(server, targets, false)
	current, err := connectivityServer(c)
	if err != nil || connectivityKey(current) != key || !canRunConnectivity(c, current) {
		return nil, errors.New("server changed; reload")
	}
	if callerIsAdmin(c) {
		_, err = connectivityManager.StartImmediate(key, c.Param("target"), probe, targets)
	} else if target := c.Param("target"); target != "" {
		_, err = connectivityManager.StartTarget(key, target, probe, targets)
	} else {
		_, err = connectivityManager.Start(key, probe, targets)
	}
	if err != nil {
		return nil, err
	}
	return getConnectivity(c)
}

// @Summary Retest one configured application from this node
// @Description Owner/admin only. Shares full-batch cooldown and concurrency limits.
// @Tags auth required
// @Security BearerAuth
// @Param id path uint true "Server ID"
// @Param target path string true "Enabled catalog target ID"
// @Success 200 {object} model.CommonResponse[connectivityResponse]
// @Router /server/{id}/connectivity/{target} [post]
func startConnectivityTarget(c *gin.Context) (*connectivityResponse, error) {
	return startConnectivity(c)
}
func localConnectivityResponse(server *model.Server, targets []connectivity.Target) *connectivityResponse {
	results := make([]connectivity.Result, 0, len(targets))
	for _, target := range targets {
		results = append(results, connectivity.Result{Target: target, Status: "pending", Samples: []connectivity.Sample{}})
	}
	return &connectivityResponse{Snapshot: connectivity.Snapshot{State: "idle", Rounds: connectivity.MeasuredRounds, Results: results}, LocalOnly: true, ServerID: server.ID, Online: rpc.ConnectivityOnline(server), CanRun: false}
}
