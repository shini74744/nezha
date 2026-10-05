package controller

import (
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
)

// Unknown reports are rejected reconnect attempts of previously deleted UUIDs.
// Normal new authenticated Agents retain the existing registration path.
func listUnknownAgentReports(c *gin.Context) (*model.Value[[]model.ServerDeletionTombstone], error) {
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
	query := singleton.DB.Model(&model.ServerDeletionTombstone{}).Where("report_count > 0")
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, err
	}
	rows := make([]model.ServerDeletionTombstone, 0)
	if err := query.Order("last_report_at DESC").Limit(limit).Offset(offset).Find(&rows).Error; err != nil {
		return nil, err
	}
	return &model.Value[[]model.ServerDeletionTombstone]{
		Value: rows, Pagination: model.Pagination{Total: total, Offset: offset, Limit: limit},
	}, nil
}
