package controller

import (
	"encoding/json"
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/service/networkinsight"
	"github.com/nezhahq/nezha/service/singleton"
	"io"
	"net/http"
)

type detectionPriorityState struct {
	networkinsight.DetectionPriority
	Revision string `json:"revision"`
}

func detectionPriorityRevision(p networkinsight.DetectionPriority) detectionPriorityState {
	raw, _ := json.Marshal(p)
	return detectionPriorityState{p, appearanceRevision(string(raw), "detection-priority")}
}
func getDetectionPriority(c *gin.Context) (*detectionPriorityState, error) {
	c.Header("Cache-Control", "no-store")
	settingsMutationMu.Lock()
	defer settingsMutationMu.Unlock()
	p, err := networkinsight.ReadDetectionPriority(singleton.DB)
	state := detectionPriorityRevision(p)
	return &state, err
}
func updateDetectionPriority(c *gin.Context) (*detectionPriorityState, error) {
	c.Header("Cache-Control", "no-store")
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	var form detectionPriorityState
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&form); err != nil {
		return nil, errors.New("优先级设置无效")
	}
	if decoder.Decode(new(any)) != io.EOF {
		return nil, errors.New("设置必须为单个 JSON 对象")
	}
	if err := form.Validate(); err != nil {
		return nil, err
	}
	settingsMutationMu.Lock()
	defer settingsMutationMu.Unlock()
	current, err := networkinsight.ReadDetectionPriority(singleton.DB)
	if err != nil {
		return nil, err
	}
	if form.Revision != detectionPriorityRevision(current).Revision {
		return nil, errors.New("设置已被其他页面修改，请重新加载")
	}
	form.ID = 1
	if err = singleton.DB.Save(&form.DetectionPriority).Error; err != nil {
		return nil, err
	}
	state := detectionPriorityRevision(form.DetectionPriority)
	return &state, nil
}
