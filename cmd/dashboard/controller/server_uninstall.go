package controller

import (
	"context"
	"errors"
	"log"
	"slices"
	"strings"
	"sync"
	"time"

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

var serverDeletionRequestMu sync.Mutex
var onlineUninstallSlots = make(chan struct{}, 8)

type serverRemovalPlan struct {
	uuid    string
	command string
	launch  func(context.Context, string) error
	result  ServerCleanupResult
}

func planServerRemoval(server *model.Server) serverRemovalPlan {
	p := serverRemovalPlan{uuid: server.UUID, result: ServerCleanupResult{ID: server.ID, Status: "offline", Message: "节点离线，仅删除并拉黑，不再自动卸载"}}
	connection := rpc.PrepareAgentUninstall(server)
	if connection == nil {
		return p
	}
	platform := ""
	if host := server.RuntimeSnapshot().Host; host != nil {
		platform = host.Platform
	}
	command, err := agentuninstall.Command(server.UUID, platform)
	if strings.Contains(strings.ToLower(server.Name), "f50") {
		err = errors.New("此类节点不支持远程卸载")
	}
	if err != nil {
		p.result.Status = "unsupported"
		p.result.Message = "节点已删除并拉黑，请在服务器上手动卸载"
		return p
	}
	p.command, p.launch = command, connection.Launch
	p.result.Status, p.result.Message = "queued", "节点已删除并拉黑，正在后台尝试卸载"
	return p
}
func deleteServersAndUninstall(c *gin.Context, ids []uint64) (*ServerDeleteResult, error) {
	ids = slices.Compact(slices.Sorted(slices.Values(ids)))
	if len(ids) == 0 || len(ids) > 500 {
		return nil, errors.New("每次请选择 1–500 个节点")
	}
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
	identities := make(map[uint64]singleton.ServerDeleteIdentity)
	plans := make(map[string]serverRemovalPlan)
	result := &ServerDeleteResult{Cleanup: make([]ServerCleanupResult, 0, len(ids))}
	for _, id := range ids {
		server, ok := singleton.ServerShared.Get(id)
		if !ok || server == nil {
			return nil, errors.New("节点不存在，请刷新列表")
		}
		if !server.HasPermission(c) {
			return nil, singleton.Localizer.ErrorT("permission denied")
		}
		identities[id] = singleton.ServerDeleteIdentity{UUID: server.UUID, UserID: server.GetUserID()}
		plan := planServerRemoval(server)
		plans[server.UUID] = plan
		result.Cleanup = append(result.Cleanup, plan.result)
	}
	// No remote work is launched unless deletion and the UUID blacklist COMMIT.
	// Browser cancellation and remote failures cannot undo that blacklist.
	err := singleton.DeleteServersThen(ids, identities, func(rows []model.ServerDeletionTombstone) {
		for _, row := range rows {
			plan := plans[row.UUID]
			go executeServerRemoval(plan, row)
		}
	}, model.ServerOperationActorFromContext(c))
	if err != nil {
		return nil, err
	}
	result.Deleted = ids
	return result, nil
}
func executeServerRemoval(plan serverRemovalPlan, row model.ServerDeletionTombstone) {
	state, message := plan.result.Status, plan.result.Message
	saveResult := true
	defer func() {
		if !saveResult {
			return
		}
		if err := singleton.FinishDeletedOnlineUninstall(row, state, message); err != nil {
			log.Printf("NEZHA>> save one-shot uninstall status: %v", err)
		}
	}()
	if plan.launch == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	select {
	case onlineUninstallSlots <- struct{}{}:
		defer func() { <-onlineUninstallSlots }()
	case <-ctx.Done():
		state, message = "failed", "未能及时下发卸载命令，请在服务器上手动卸载"
		return
	}
	allowed, err := singleton.BeginDeletedOnlineUninstall(row)
	if err != nil {
		state, message = "failed", "未能启动卸载，请在服务器上手动检查"
		return
	}
	if !allowed {
		saveResult = false
		return
	} // released, cleared, retried, or replaced; never redispatch.
	if err := plan.launch(ctx, plan.command); err != nil {
		state, message = "failed", "未确认卸载成功，请在服务器上手动检查；UUID 仍被拉黑"
	} else {
		state, message = "started", "卸载命令已启动；是否完成请在服务器上确认"
	}
}
