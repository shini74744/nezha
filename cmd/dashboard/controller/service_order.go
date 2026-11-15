package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/service/singleton"
)

type serviceOrderForm struct {
	ServiceIDs  []uint64 `json:"service_ids" binding:"required"`
	OriginalIDs []uint64 `json:"original_ids" binding:"required"`
}

// updateServiceOrder persists display order only; monitor identities and jobs stay intact.
// @Summary Update service display order
// @Security BearerAuth
// @Tags auth required
// @Accept json
// @Param request body serviceOrderForm true "Complete visible service order"
// @Produce json
// @Success 200 {object} model.CommonResponse[any]
// @Router /service/order [post]
func updateServiceOrder(c *gin.Context) (any, error) {
	var form serviceOrderForm
	if err := c.ShouldBindJSON(&form); err != nil {
		return nil, err
	}
	return nil, singleton.ServiceSentinelShared.UpdateManualOrder(c, form.ServiceIDs, form.OriginalIDs)
}
