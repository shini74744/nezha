package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"strconv"
)

// notificationEditor is deliberately write-scoped: list/read access must never
// reveal webhook credentials. Load only when an authorized editor is opened.
// @Summary Read notification configuration for editing
// @Security BearerAuth
// @Tags auth required
// @Param id path uint true "Notification ID"
// @Success 200 {object} model.CommonResponse[model.Notification]
// @Router /notification/{id}/editor [get]
func notificationEditor(c *gin.Context) (*model.Notification, error) {
	c.Header("Cache-Control", "no-store")
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		return nil, err
	}
	var n model.Notification
	if err := singleton.DB.First(&n, id).Error; err != nil {
		return nil, singleton.Localizer.ErrorT("notification id %d does not exist", id)
	}
	if !n.HasPermission(c) {
		return nil, singleton.Localizer.ErrorT("permission denied")
	}
	return &n, nil
}
