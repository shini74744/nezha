package controller

import (
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"log"
)

// Authentication checks the persisted epoch even if connection cleanup fails.
func revokeUserPATConnections(userID uint64) {
	var ids []uint64
	if err := singleton.DB.Model(&model.APIToken{}).Where("user_id = ?", userID).Pluck("id", &ids).Error; err != nil {
		log.Printf("DDnezha: cannot close revoked API token connections for user %d: %v", userID, err)
		return
	}
	for _, id := range ids {
		patConnectionRegistryShared.revokeToken(id)
	}
}
