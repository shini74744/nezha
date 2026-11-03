package controller

import (
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/goccy/go-json"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"gorm.io/gorm"
	"strconv"
)

type homeNetworkForm struct {
	Interfaces []string `json:"interfaces"`
}

func homeNetworkServer(c *gin.Context) (*model.Server, error) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		return nil, err
	}
	s, ok := singleton.ServerShared.Get(id)
	if !ok || s == nil || !callerIsAdmin(c) || !s.HasPermission(c) {
		return nil, errors.New("permission denied")
	}
	return s, nil
}
func getHomeNetwork(c *gin.Context) (homeNetworkForm, error) {
	s, err := homeNetworkServer(c)
	if err != nil {
		return homeNetworkForm{}, err
	}
	names := s.HomeNetworkNames()
	if names == nil {
		names = []string{}
	}
	return homeNetworkForm{Interfaces: names}, nil
}
func setHomeNetwork(c *gin.Context) (homeNetworkForm, error) {
	old, err := homeNetworkServer(c)
	if err != nil {
		return homeNetworkForm{}, err
	}
	var form homeNetworkForm
	if err = c.ShouldBindJSON(&form); err != nil {
		return form, err
	}
	form.Interfaces, err = model.NormalizeHomeNetworkNames(form.Interfaces)
	if err != nil {
		return form, err
	}
	encoded, err := json.Marshal(form.Interfaces)
	if err != nil {
		return form, err
	}
	logoLibraryMu.Lock()
	defer logoLibraryMu.Unlock()
	var s model.Server
	if err = singleton.DB.First(&s, old.ID).Error; err != nil {
		return form, err
	}
	if s.UUID != old.UUID || !s.HasPermission(c) {
		return form, errors.New("节点已变化，请刷新后重试")
	}
	s.HomeNetworkInterfacesRaw = string(encoded)
	err = model.WithServerOperation(singleton.DB, model.ServerOperationActorFromContext(c), "edit", []uint64{s.ID}, func(tx *gorm.DB) error {
		result := tx.Model(&model.Server{}).Where("id = ? AND uuid = ? AND user_id = ?", s.ID, s.UUID, s.UserID).Update("home_network_interfaces_raw", s.HomeNetworkInterfacesRaw)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("节点已变化，请刷新后重试")
		}
		return nil
	})
	if err != nil {
		return form, err
	}
	running, _ := singleton.ServerShared.Get(s.ID)
	s.CopyFromRunningServer(running)
	singleton.ServerShared.Update(&s, "")
	return form, nil
}
