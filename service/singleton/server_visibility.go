package singleton

import (
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"gorm.io/gorm"
)

// UpdateVisibility atomically updates selected flags without triggering DDNS,
// importing logos, changing agent state, or writing other server settings.
func (c *ServerClass) UpdateVisibility(ctx *gin.Context, form model.BatchServerVisibilityForm) (int, error) {
	if len(form.IDs) == 0 || len(form.IDs) > 1000 {
		return 0, errors.New("请选择 1 至 1000 台服务器")
	}
	if form.HideForGuest == nil && form.HideForDisplay == nil {
		return 0, errors.New("请选择要修改的隐藏设置")
	}
	if ServerIDReassignmentInProgress.Load() {
		return 0, errors.New("服务器 ID 正在调整，请稍后重试")
	}
	ids := make([]uint64, 0, len(form.IDs))
	seen := map[uint64]bool{}
	for _, id := range form.IDs {
		if id == 0 {
			return 0, errors.New("服务器选择无效")
		}
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	c.lockLifecycleWrite()
	defer c.unlockLifecycleWrite()
	var servers []model.Server
	err := model.WithServerOperation(DB, model.ServerOperationActorFromContext(ctx), "visibility", ids, func(tx *gorm.DB) error {
		if err := tx.Where("id IN ?", ids).Find(&servers).Error; err != nil {
			return err
		}
		if len(servers) != len(ids) {
			return errors.New("所选服务器不存在或无权修改，请刷新列表")
		}
		for i := range servers {
			running, ok := c.Get(servers[i].ID)
			if !ok || !servers[i].HasPermission(ctx) || !running.HasPermission(ctx) {
				return errors.New("所选服务器不存在或无权修改，请刷新列表")
			}
		}
		updates := map[string]any{}
		if form.HideForGuest != nil {
			updates["hide_for_guest"] = *form.HideForGuest
		}
		if form.HideForDisplay != nil {
			updates["hide_for_display"] = *form.HideForDisplay
		}
		result := tx.Model(&model.Server{}).Where("id IN ?", ids).Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != int64(len(ids)) {
			return errors.New("更新数量不一致，未保存任何更改")
		}
		return tx.Where("id IN ?", ids).Find(&servers).Error
	})
	if err != nil {
		return 0, err
	}
	c.listMu.Lock()
	for i := range servers {
		server := &servers[i]
		server.CopyFromRunningServer(c.list[server.ID])
		c.list[server.ID] = server
	}
	c.listMu.Unlock()
	c.sortList()
	return len(servers), nil
}
