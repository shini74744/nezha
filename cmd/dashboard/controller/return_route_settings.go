package controller

import (
	"encoding/json"
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/networkinsight"
	"github.com/nezhahq/nezha/service/singleton"
	"io"
	"net/http"
	"sync/atomic"
)

var returnRouteAutoEnabled = func() *atomic.Bool { v := &atomic.Bool{}; v.Store(false); return v }()

type returnRoutePolicyState struct {
	networkinsight.ReturnPolicy
	Revision string `json:"revision"`
}

// Keep the concrete response type available to Swagger generic resolution.
type returnRoutePolicyResponse = model.CommonResponse[returnRoutePolicyState]

func returnRoutePolicyRevision(p networkinsight.ReturnPolicy) returnRoutePolicyState {
	raw, _ := json.Marshal(p)
	return returnRoutePolicyState{p, appearanceRevision(string(raw), "return-route-policy")}
}

// @Summary Read return-route automation policy
// @Tags auth required
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse[returnRoutePolicyState]
// @Router /setting/return-route [get]
func getReturnRouteSettings(c *gin.Context) (*returnRoutePolicyState, error) {
	c.Header("Cache-Control", "no-store")
	settingsMutationMu.Lock()
	defer settingsMutationMu.Unlock()
	p, err := networkinsight.ReadReturnPolicy(singleton.DB)
	state := returnRoutePolicyRevision(p)
	return &state, err
}

// @Summary Save return-route automation policy (admin only)
// @Tags auth required
// @Security BearerAuth
// @Param request body returnRoutePolicyState true "Policy with revision"
// @Success 200 {object} model.CommonResponse[returnRoutePolicyState]
// @Router /setting/return-route [put]
func updateReturnRouteSettings(c *gin.Context) (*returnRoutePolicyState, error) {
	c.Header("Cache-Control", "no-store")
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16384)
	var form returnRoutePolicyState
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&form); err != nil {
		return nil, errors.New("回程设置无效")
	}
	if decoder.Decode(new(any)) != io.EOF {
		return nil, errors.New("回程设置必须为单个 JSON 对象")
	}
	if err := form.ReturnPolicy.Validate(); err != nil {
		return nil, err
	}
	settingsMutationMu.Lock()
	defer settingsMutationMu.Unlock()
	current, err := networkinsight.ReadReturnPolicy(singleton.DB)
	if err != nil {
		return nil, err
	}
	if form.Revision != returnRoutePolicyRevision(current).Revision {
		return nil, errors.New("设置已被其他页面修改，请重新加载")
	}
	form.ReturnPolicy.ID = 1
	if err = singleton.DB.Save(&form.ReturnPolicy).Error; err != nil {
		return nil, err
	}
	returnRouteAutoEnabled.Store(form.ReturnPolicy.Enabled)
	state := returnRoutePolicyRevision(form.ReturnPolicy)
	return &state, nil
}
