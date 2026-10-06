package controller

import (
	"encoding/json"
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/service/networkinsight"
	"github.com/nezhahq/nezha/service/singleton"
	"io"
	"net/http"
	"sync/atomic"
)

var bgpAutoEnabled = func() *atomic.Bool { v := &atomic.Bool{}; v.Store(true); return v }()

type bgpPolicyState struct {
	networkinsight.BGPPolicy
	Revision string `json:"revision"`
}

func bgpPolicyRevision(p networkinsight.BGPPolicy) bgpPolicyState {
	raw, _ := json.Marshal(p)
	return bgpPolicyState{p, appearanceRevision(string(raw), "bgp-policy")}
}

// @Summary Read BGP automation policy
// @Tags auth required
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse[bgpPolicyState]
// @Router /setting/bgp/automation [get]
func getBGPAutomation(c *gin.Context) (*bgpPolicyState, error) {
	c.Header("Cache-Control", "no-store")
	settingsMutationMu.Lock()
	defer settingsMutationMu.Unlock()
	p, err := networkinsight.ReadBGPPolicy(singleton.DB)
	state := bgpPolicyRevision(p)
	return &state, err
}

// @Summary Save BGP automation policy (admin only)
// @Tags auth required
// @Security BearerAuth
// @Param request body bgpPolicyState true "Policy with revision"
// @Success 200 {object} model.CommonResponse[bgpPolicyState]
// @Router /setting/bgp/automation [put]
func updateBGPAutomation(c *gin.Context) (*bgpPolicyState, error) {
	c.Header("Cache-Control", "no-store")
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	var form bgpPolicyState
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&form); err != nil {
		return nil, errors.New("自动检测设置无效")
	}
	if decoder.Decode(new(any)) != io.EOF {
		return nil, errors.New("自动检测设置必须为单个 JSON 对象")
	}
	if err := form.BGPPolicy.Validate(); err != nil {
		return nil, err
	}
	settingsMutationMu.Lock()
	defer settingsMutationMu.Unlock()
	current, err := networkinsight.ReadBGPPolicy(singleton.DB)
	if err != nil {
		return nil, err
	}
	if form.Revision != bgpPolicyRevision(current).Revision {
		return nil, errors.New("设置已被其他页面修改，请重新加载")
	}
	form.BGPPolicy.ID = 1
	if err = singleton.DB.Save(&form.BGPPolicy).Error; err != nil {
		return nil, err
	}
	bgpAutoEnabled.Store(form.BGPPolicy.Enabled)
	state := bgpPolicyRevision(form.BGPPolicy)
	return &state, nil
}
