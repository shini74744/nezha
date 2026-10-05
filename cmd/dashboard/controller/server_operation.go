package controller

import (
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"gorm.io/gorm"
)

func operationPage(c *gin.Context) (int, int) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit < 1 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	offset, _ := strconv.Atoi(c.Query("offset"))
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}

// Administrator-only: records may refer to deleted nodes and prior owners.
// Historical IDs are deliberately not filtered through the current inventory.
func listServerOperations(c *gin.Context) (*model.Value[[]model.ServerOperationLog], error) {
	limit, offset := operationPage(c)
	query := singleton.DB.Model(&model.ServerOperationLog{})
	if q := strings.TrimSpace(c.Query("q")); q != "" {
		if len([]rune(q)) > 200 {
			q = string([]rune(q)[:200])
		}
		id, idErr := strconv.ParseUint(q, 10, 64)
		escaped := strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_").Replace(q)
		if idErr == nil && id > 0 {
			query = query.Where("(server_name LIKE ? ESCAPE '\\' OR server_uuid = ? OR server_id = ? OR previous_id = ?)", "%"+escaped+"%", q, id, id)
		} else {
			query = query.Where("(server_name LIKE ? ESCAPE '\\' OR server_uuid = ?)", "%"+escaped+"%", q)
		}
	}
	if action := c.Query("action"); action != "" {
		query = query.Where("action = ?", action)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, err
	}
	rows := make([]model.ServerOperationLog, 0)
	if err := query.Order("id DESC").Limit(limit).Offset(offset).Find(&rows).Error; err != nil {
		return nil, err
	}
	return &model.Value[[]model.ServerOperationLog]{Value: rows, Pagination: model.Pagination{Total: total, Offset: offset, Limit: limit}}, nil
}

func listDeletedServers(c *gin.Context) (*model.Value[[]model.ServerDeletionTombstone], error) {
	limit, offset := operationPage(c)
	query := singleton.DB.Model(&model.ServerDeletionTombstone{})
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, err
	}
	rows := make([]model.ServerDeletionTombstone, 0)
	if err := query.Order("created_at DESC, uuid ASC").Limit(limit).Offset(offset).Find(&rows).Error; err != nil {
		return nil, err
	}
	return &model.Value[[]model.ServerDeletionTombstone]{Value: rows, Pagination: model.Pagination{Total: total, Offset: offset, Limit: limit}}, nil
}

// Record intent before dispatch. It is intentionally NOT a success receipt:
// Agent restart/config application may finish later or fail after transmission.
func recordAgentOperationRequest(c *gin.Context, servers []*model.Server, action, field, description string) error {
	actor := model.ServerOperationActorFromContext(c)
	return singleton.DB.Transaction(func(tx *gorm.DB) error {
		for _, server := range servers {
			if err := model.RecordServerOperationChanges(tx, actor, action, server, server.ID,
				[]model.ServerOperationChange{{Field: field, Before: "—", After: description}}); err != nil {
				return err
			}
		}
		return nil
	})
}
