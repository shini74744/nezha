package controller

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/agentuninstall"
	"github.com/nezhahq/nezha/service/rpc"
	"github.com/nezhahq/nezha/service/singleton"
)

type ServerCleanupResult struct {
	ID      uint64 `json:"id"`
	Status  string `json:"status"`
	Message string `json:"message"`
}
type ServerDeleteResult struct {
	Deleted []uint64              `json:"deleted"`
	Cleanup []ServerCleanupResult `json:"cleanup"`
}

// Prevent double-clicks/concurrent requests from launching duplicate workers.
var serverDeletionRequestMu sync.Mutex

func deleteServersAndUninstall(c *gin.Context, ids []uint64) (*ServerDeleteResult, error) {
	ids = slices.Compact(slices.Sorted(slices.Values(ids)))
	if len(ids) == 0 || len(ids) > 500 {
		return nil, errors.New("每次请选择 1–500 个节点")
	}
	// Inventory deletion now includes remote execution. Do not widen old PATs.
	if token := APITokenFromContext(c); token != nil && !token.HasScope(model.ScopeServerExec) {
		return nil, errors.New("ApiErrorForbidden: api token lacks scope " + model.ScopeServerExec)
	}
	serverDeletionRequestMu.Lock()
	defer serverDeletionRequestMu.Unlock()
	if singleton.ServerIDReassignmentInProgress.Load() {
		return nil, errors.New("server ID reassignment in progress")
	}
	if !singleton.ServerShared.CheckPermission(c, slices.Values(ids)) {
		return nil, singleton.Localizer.ErrorT("permission denied")
	}
	servers := make([]*model.Server, 0, len(ids))
	identities := make(map[uint64]singleton.ServerDeleteIdentity)
	for _, id := range ids {
		server, ok := singleton.ServerShared.Get(id)
		if !ok || server == nil {
			return nil, errors.New("节点不存在，请刷新列表")
		}
		// Re-check the snapshot that will actually receive the command.
		if !server.HasPermission(c) {
			return nil, singleton.Localizer.ErrorT("permission denied")
		}
		servers = append(servers, server)
		identities[id] = singleton.ServerDeleteIdentity{UUID: server.UUID, UserID: server.GetUserID()}
	}
	// Once accepted, browser navigation must not leave already-started cleanup
	// workers unaccompanied by the persistent deletion/UUID block.
	result := prepareServerRemoval(context.WithoutCancel(c.Request.Context()), servers, rpc.LaunchAgentUninstall)
	if err := singleton.PermanentlyDeleteServersMatching(ids, identities); err != nil {
		return nil, fmt.Errorf("远端清理可能已启动，但面板删除未完成：%w", err)
	}
	result.Deleted = ids
	return result, nil
}

func prepareServerRemoval(ctx context.Context, servers []*model.Server, launch func(context.Context, *model.Server, string) error) *ServerDeleteResult {
	result := &ServerDeleteResult{Cleanup: make([]ServerCleanupResult, len(servers))}
	slots := make(chan struct{}, 8)
	var workers sync.WaitGroup
	for index, server := range servers {
		workers.Add(1)
		go func(index int, server *model.Server) {
			defer workers.Done()
			slots <- struct{}{}
			defer func() { <-slots }()
			item := ServerCleanupResult{ID: server.ID}
			if server.GetTaskStream() == nil {
				item.Status, item.Message = "offline", "节点离线，无法执行远端清理；已删除记录并拉黑 UUID"
			} else {
				runtime := server.RuntimeSnapshot()
				platform := ""
				if runtime.Host != nil {
					platform = runtime.Host.Platform
				}
				command, err := agentuninstall.Command(server.UUID, platform)
				if strings.Contains(strings.ToLower(server.Name), "f50") {
					err = errors.New("F50 等特殊节点不执行标准 Agent 卸载")
				}
				if err != nil {
					item.Status, item.Message = "unsupported", err.Error()+"；已删除记录并拉黑 UUID"
				} else if err := launch(ctx, server, command); err != nil {
					item.Status, item.Message = "failed", "远端清理未确认；已删除记录并拉黑 UUID"
				} else {
					item.Status, item.Message = "started", "卸载清理任务已启动；已删除记录并拉黑 UUID（非卸载完成回执）"
				}
			}
			result.Cleanup[index] = item
		}(index, server)
	}
	workers.Wait()
	return result
}
