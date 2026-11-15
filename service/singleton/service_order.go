package singleton

import (
	"errors"
	"slices"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/utils"
	"gorm.io/gorm"
)

// Serialize API edits with ordering so an older edit cannot restore old positions.
var ServiceMutationMu sync.Mutex

func (ss *ServiceSentinel) UpdateManualOrder(ctx *gin.Context, ids, originalIDs []uint64) error {
	auth, ok := ctx.Get(model.CtxKeyAuthorizedUser)
	user, valid := auth.(*model.User)
	if !ok || !valid || user == nil {
		return errors.New("permission denied")
	}
	if len(ids) == 0 || len(ids) != len(originalIDs) {
		return errors.New("服务列表已变化，请刷新后重新排序")
	}
	seen := make(map[uint64]bool, len(ids))
	for _, id := range ids {
		if id == 0 || seen[id] {
			return errors.New("服务排序包含无效或重复的服务")
		}
		seen[id] = true
	}
	ServiceMutationMu.Lock()
	defer ServiceMutationMu.Unlock()
	ss.servicesLock.Lock()
	defer ss.servicesLock.Unlock()
	ss.serviceListLock.Lock()
	defer ss.serviceListLock.Unlock()

	positions := make(map[uint64]int, len(ids))
	err := DB.Transaction(func(tx *gorm.DB) error {
		var rows []*model.Service
		if err := tx.Where("type IN ?", []int{1, 2, 3}).Find(&rows).Error; err != nil {
			return err
		}
		sortServices(rows)
		current := make([]uint64, 0, len(rows))
		for _, row := range rows {
			if !row.HasPermission(ctx) {
				continue
			}
			running := ss.services[row.ID]
			if running == nil || !running.HasPermission(ctx) || running.GetUserID() != row.GetUserID() {
				return errors.New("服务列表已变化，请刷新后重新排序")
			}
			current = append(current, row.ID)
		}
		if !slices.Equal(current, originalIDs) || len(current) != len(ids) {
			return errors.New("服务列表或顺序已变化，请关闭后重新打开排序")
		}
		for _, id := range current {
			if !seen[id] {
				return errors.New("服务列表已变化，请刷新后重新排序")
			}
		}
		for i, id := range ids {
			position := len(ids) - i
			result := tx.Model(&model.Service{}).Where("id = ?", id).UpdateColumn("display_index", position)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return errors.New("服务列表已变化，未保存任何更改")
			}
			positions[id] = position
		}
		return nil
	})
	if err != nil {
		return err
	}
	// Publish new snapshots: readers and already scheduled probes may still hold
	// the old objects. Ordering must not restart jobs or reset monitoring history.
	for id, position := range positions {
		next := *ss.services[id]
		next.DisplayIndex = position
		ss.services[id] = &next
	}
	ss.serviceList = utils.MapValuesToSlice(ss.services)
	sortServices(ss.serviceList)
	return nil
}
