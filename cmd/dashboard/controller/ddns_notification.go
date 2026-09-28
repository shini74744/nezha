package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
)

func validateDDNSNotificationGroup(c *gin.Context, id, owner uint64) error {
	if id == 0 {
		return nil
	}
	if err := assertOwnsNotificationGroup(c, id); err != nil {
		return err
	}
	var g model.NotificationGroup
	if err := singleton.DB.First(&g, id).Error; err != nil {
		return err
	}
	if !singleton.DDNSNotificationGroupAllowed(g.UserID, owner) {
		return singleton.Localizer.ErrorT("permission denied")
	}
	return nil
}
