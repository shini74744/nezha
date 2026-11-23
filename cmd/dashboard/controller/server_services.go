package controller

import (
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/goccy/go-json"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"gorm.io/gorm"
)

type serverServicesForm struct {
	Services []model.ServerServicePreference `json:"services" binding:"required"`
}
type serverServiceChoice struct {
	ID              uint64 `json:"id"`
	Name            string `json:"name"`
	Color           string `json:"chart_color"`
	DefaultIncluded bool   `json:"default_included"`
}
type serverServicesView struct {
	Services  []model.ServerServicePreference `json:"services"`
	Available []serverServiceChoice           `json:"available"`
}

func serviceOwnedForServer(service *model.Service, server *model.Server) bool {
	return service.GetUserID() == server.GetUserID() || (model.OwnerIsAdminLookup != nil && model.OwnerIsAdminLookup(service.GetUserID()))
}

// getServerServices returns the server-bound service selection and available services.
// @Summary Read server service selection
// @Security BearerAuth
// @Tags auth required
// @Param id path uint true "Server ID"
// @Success 200 {object} model.CommonResponse[serverServicesView]
// @Router /server/{id}/services [get]
func getServerServices(c *gin.Context) (serverServicesView, error) {
	s, err := homeNetworkServer(c)
	if err != nil {
		return serverServicesView{}, err
	}
	rows, err := s.ServicePreferences()
	if err != nil {
		return serverServicesView{}, errors.New("服务设置无法读取，请恢复默认后重试")
	}
	view := serverServicesView{Services: rows, Available: []serverServiceChoice{}}
	for _, svc := range singleton.ServiceSentinelShared.GetSortedList() {
		if !svc.HasPermission(c) || !serviceOwnedForServer(svc, s) {
			continue
		}
		included := (svc.Cover == model.ServiceCoverAll && !svc.SkipServers[s.ID]) || (svc.Cover == model.ServiceCoverIgnoreAll && svc.SkipServers[s.ID])
		view.Available = append(view.Available, serverServiceChoice{ID: svc.ID, Name: svc.Name, Color: svc.ChartColor, DefaultIncluded: included})
	}
	return view, nil
}

// setServerServices persists selection, ordering and optional color overrides.
// @Summary Save server service selection
// @Security BearerAuth
// @Tags auth required
// @Accept json
// @Param id path uint true "Server ID"
// @Param request body serverServicesForm true "An empty services array restores defaults"
// @Success 200 {object} model.CommonResponse[serverServicesView]
// @Router /server/{id}/services [put]
func setServerServices(c *gin.Context) (serverServicesView, error) {
	old, err := homeNetworkServer(c)
	if err != nil {
		return serverServicesView{}, err
	}
	var form serverServicesForm
	if err = c.ShouldBindJSON(&form); err != nil {
		return serverServicesView{}, err
	}
	form.Services, err = model.NormalizeServerServices(form.Services)
	if err != nil {
		return serverServicesView{}, err
	}

	singleton.ServiceMutationMu.Lock()
	defer singleton.ServiceMutationMu.Unlock()
	logoLibraryMu.Lock()
	defer logoLibraryMu.Unlock()
	var s model.Server
	if err = singleton.DB.First(&s, old.ID).Error; err != nil {
		return serverServicesView{}, err
	}
	if s.UUID != old.UUID || !s.HasPermission(c) {
		return serverServicesView{}, errors.New("节点已变化，请刷新后重试")
	}
	for _, row := range form.Services {
		svc, ok := singleton.ServiceSentinelShared.Get(row.ServiceID)
		if !ok || !model.IsServiceMonitorType(uint64(svc.Type)) || !svc.HasPermission(c) || !serviceOwnedForServer(svc, &s) {
			return serverServicesView{}, errors.New("服务已删除或无权选择，请刷新服务列表")
		}
	}
	encoded, err := json.Marshal(form.Services)
	if err != nil {
		return serverServicesView{}, err
	}
	s.ServicePreferencesRaw = string(encoded)
	err = model.WithServerOperation(singleton.DB, model.ServerOperationActorFromContext(c), "edit", []uint64{s.ID}, func(tx *gorm.DB) error {
		result := tx.Model(&model.Server{}).Where("id = ? AND uuid = ? AND user_id = ?", s.ID, s.UUID, s.UserID).Update("service_preferences_raw", s.ServicePreferencesRaw)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("节点已变化，请刷新后重试")
		}
		return nil
	})
	if err != nil {
		return serverServicesView{}, err
	}
	running, _ := singleton.ServerShared.Get(s.ID)
	s.CopyFromRunningServer(running)
	singleton.ServerShared.Update(&s, "")
	return getServerServices(c)
}
