package singleton

import (
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"gorm.io/gorm"
)

// UpdateManualOrder persists the entire requested order without changing IDs,
// unrelated settings or live Agent state. It does not run DDNS or import logos.
func (c *ServerClass) UpdateManualOrder(ctx *gin.Context, ids []uint64) error {
	user, ok := ctx.Get(model.CtxKeyAuthorizedUser)
	admin, valid := user.(*model.User)
	if !ok || !valid || admin == nil || !admin.Role.IsAdmin() {
		return errors.New("permission denied")
	}
	if len(ids) == 0 {
		return errors.New("server order cannot be empty")
	}
	seen := make(map[uint64]int, len(ids))
	for i, id := range ids {
		if id == 0 {
			return errors.New("server id cannot be zero")
		}
		if _, ok := seen[id]; ok {
			return errors.New("duplicate server id")
		}
		seen[id] = len(ids) - i
	}
	if ServerIDReassignmentInProgress.Load() {
		return errors.New("服务器 ID 正在调整，请稍后重试")
	}
	c.lockLifecycleWrite()
	defer c.unlockLifecycleWrite()
	var servers []model.Server
	err := model.WithServerOperation(DB, model.ServerOperationActorFromContext(ctx), "order", ids, func(tx *gorm.DB) error {
		if err := tx.Find(&servers).Error; err != nil {
			return err
		}
		if len(servers) != len(ids) {
			return errors.New("服务器列表已变化，请刷新后重新排序")
		}
		for i := range servers {
			server := &servers[i]
			position, exists := seen[server.ID]
			if !exists {
				return errors.New("服务器列表已变化，请刷新后重新排序")
			}
			running, ok := c.Get(server.ID)
			if !ok || running.UUID != server.UUID || !server.HasPermission(ctx) || !running.HasPermission(ctx) {
				return errors.New("所选服务器不存在或无权修改，请刷新列表")
			}
			if server.DisplayIndex == position {
				continue
			}
			result := tx.Model(&model.Server{}).Where("id = ? AND uuid = ?", server.ID, server.UUID).Update("display_index", position)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return errors.New("服务器列表已变化，未保存任何更改")
			}
			server.DisplayIndex = position
		}
		return nil
	})
	if err != nil {
		return err
	}
	c.listMu.Lock()
	for i := range servers {
		server := &servers[i]
		server.CopyFromRunningServer(c.list[server.ID])
		c.list[server.ID] = server
	}
	c.listMu.Unlock()
	c.sortList()
	return nil
}
