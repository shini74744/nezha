package controller

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/connectivity"
	"github.com/nezhahq/nezha/service/singleton"
)

type connectivitySettings struct {
	Revision   string                     `json:"revision"`
	Items      []connectivity.CatalogItem `json:"items"`
	Defaults   []connectivity.CatalogItem `json:"defaults"`
	MaxTargets int                        `json:"max_targets"`
}
type connectivitySettingsForm struct {
	Revision string                     `json:"revision"`
	Items    []connectivity.CatalogItem `json:"items"`
}

func connectivityCatalogState(raw string) (*connectivitySettings, error) {
	items, err := connectivity.ParseCatalog(raw)
	if err != nil {
		return nil, err
	}
	return &connectivitySettings{Revision: appearanceRevision(raw, "connectivity"), Items: items, Defaults: connectivity.DefaultCatalog(), MaxTargets: connectivity.MaxTargets}, nil
}
func configuredConnectivityTargets() ([]connectivity.Target, error) {
	settingsMutationMu.Lock()
	defer settingsMutationMu.Unlock()
	raw := ""
	if singleton.Conf != nil && singleton.Conf.Config != nil {
		raw = singleton.Conf.ConnectivityConfig
	}
	items, err := connectivity.ParseCatalog(raw)
	if err != nil {
		return nil, errors.New("connectivity configuration invalid; contact administrator")
	}
	return connectivity.EnabledTargets(items), nil
}
func getConnectivitySettings(c *gin.Context) (*connectivitySettings, error) {
	c.Header("Cache-Control", "no-store")
	settingsMutationMu.Lock()
	defer settingsMutationMu.Unlock()
	return connectivityCatalogState(singleton.Conf.ConnectivityConfig)
}
func saveConnectivitySettings(config *model.Config, form connectivitySettingsForm, save func() error) (*connectivitySettings, error) {
	if form.Revision != appearanceRevision(config.ConnectivityConfig, "connectivity") {
		return nil, errors.New("配置已被其他页面修改，请重新加载后再保存")
	}
	if err := connectivity.ValidateCatalog(form.Items); err != nil {
		return nil, err
	}
	raw, err := json.Marshal(form.Items)
	if err != nil {
		return nil, err
	}
	old := config.ConnectivityConfig
	config.ConnectivityConfig = string(raw)
	if err = save(); err != nil {
		config.ConnectivityConfig = old
		return nil, err
	}
	return connectivityCatalogState(config.ConnectivityConfig)
}
func updateConnectivitySettings(c *gin.Context) (*connectivitySettings, error) {
	c.Header("Cache-Control", "no-store")
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 384<<10)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	var form connectivitySettingsForm
	if err := decoder.Decode(&form); err != nil {
		return nil, errors.New("卡片设置内容无效或过大")
	}
	if decoder.Decode(new(any)) != io.EOF {
		return nil, errors.New("卡片设置必须为单个 JSON 对象")
	}
	settingsMutationMu.Lock()
	defer settingsMutationMu.Unlock()
	return saveConnectivitySettings(singleton.Conf.Config, form, singleton.Conf.Save)
}
