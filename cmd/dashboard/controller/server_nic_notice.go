package controller

import (
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"strconv"
)

// @Summary List unread NIC change reminders
// @Security BearerAuth
// @Tags server
// @Produce json
// @Success 200 {object} model.CommonResponse[map[string]string]
// @Router /server/nic-change-reminders [get]
func listNICSelectionNotices(c *gin.Context) (map[uint64]string, error) {
	result := make(map[uint64]string)
	ids := make(map[string]uint64)
	for _, server := range singleton.ServerShared.GetSortedList() {
		if server != nil && server.HasPermission(c) {
			ids[server.UUID] = server.GetID()
		}
	}
	if len(ids) == 0 {
		return result, nil
	}
	uuids := make([]string, 0, len(ids))
	for uuid := range ids {
		uuids = append(uuids, uuid)
	}
	var rows []model.ServerNICNotice
	if err := singleton.DB.Where("uuid IN ? AND unread = ?", uuids, true).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		result[ids[row.UUID]] = row.EventID
	}
	return result, nil
}

type nicSelectionNoticeReadForm struct {
	EventID string `json:"event_id" binding:"required,max=64"`
}

// @Summary Mark a visible NIC change reminder as read
// @Security BearerAuth
// @Tags server
// @Accept json
// @Produce json
// @Param id path uint64 true "Server ID"
// @Param body body nicSelectionNoticeReadForm true "Reminder"
// @Success 200 {object} model.CommonResponse[bool]
// @Router /server/{id}/nic-change-read [post]
func acknowledgeNICSelectionNotice(c *gin.Context) (bool, error) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		return false, err
	}
	server, ok := singleton.ServerShared.Get(id)
	if !ok || server == nil || !server.HasPermission(c) {
		return false, errors.New("permission denied")
	}
	var form nicSelectionNoticeReadForm
	if err := c.ShouldBindJSON(&form); err != nil {
		return false, err
	}
	return singleton.AcknowledgeNICSelectionNotice(server.UUID, form.EventID)
}
