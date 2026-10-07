package controller

import (
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"gorm.io/gorm/clause"
)

type expiryRow struct {
	ID   uint64 `json:"id"`
	Name string `json:"name"`
	model.ServerBilling
	Delivery []model.ServerExpiryDelivery `json:"delivery"`
}
type expiryPage struct {
	Config  model.ServerExpiryConfig `json:"config"`
	Servers []expiryRow              `json:"servers"`
}

func listServerExpiry(c *gin.Context) (expiryPage, error) {
	result := expiryPage{Servers: []expiryRow{}}
	conf, err := singleton.GetServerExpiryConfig()
	if err != nil {
		return result, err
	}
	result.Config = conf
	var servers []model.Server
	if err = singleton.DB.Select("id", "uuid", "name", "public_note").Order("display_index DESC, id").Find(&servers).Error; err != nil {
		return result, err
	}
	now := time.Now()
	var ledger []model.ServerExpiryDelivery
	if err = singleton.DB.Where("expires_at >= ?", now.AddDate(0, -1, 0).Unix()).Find(&ledger).Error; err != nil {
		return result, err
	}
	byUUID := map[string][]model.ServerExpiryDelivery{}
	for _, d := range ledger {
		byUUID[d.UUID] = append(byUUID[d.UUID], d)
	}
	for i := range servers {
		s := &servers[i]
		row := expiryRow{ID: s.ID, Name: s.Name, ServerBilling: model.ParseServerBilling(s.PublicNote, now), Delivery: []model.ServerExpiryDelivery{}}
		for _, d := range byUUID[s.UUID] {
			if d.ExpiresAt == row.ExpiresAt {
				row.Delivery = append(row.Delivery, d)
			}
		}
		result.Servers = append(result.Servers, row)
	}
	return result, nil
}
func saveServerExpiry(c *gin.Context) (any, error) {
	var conf model.ServerExpiryConfig
	if err := c.ShouldBindJSON(&conf); err != nil {
		return nil, err
	}
	if err := conf.Validate(); err != nil {
		return nil, err
	}
	if conf.NotificationGroupID > 0 {
		var group model.NotificationGroup
		if err := singleton.DB.First(&group, conf.NotificationGroupID).Error; err != nil {
			return nil, fmt.Errorf("请选择有效通知组")
		}
		var count int64
		if err := singleton.DB.Table("notification_group_notifications AS m").Joins("JOIN notifications AS n ON n.id = m.notification_id").Where("m.notification_group_id = ?", conf.NotificationGroupID).Count(&count).Error; err != nil {
			return nil, err
		}
		if conf.Enabled && count == 0 {
			return nil, fmt.Errorf("通知组中没有通知方式，请先添加")
		}
	}
	conf.ID = 1
	if err := singleton.DB.Clauses(clause.OnConflict{UpdateAll: true}).Create(&conf).Error; err != nil {
		return nil, err
	}
	return conf, nil
}
