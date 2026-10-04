package controller

import (
	"encoding/json"
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/service/singleton"
	"io"
	"net/http"
)

type displaySettings struct {
	StatisticsSplit    bool `json:"statistics_split"`
	DetailNetworkSplit bool `json:"detail_network_split"`
}

func currentDisplaySettings() displaySettings {
	return displaySettings{resolveOptionalBool(singleton.Conf.StatisticsSplit, true), !singleton.Conf.ShowNetworkInDetail}
}
func getDisplaySettings(c *gin.Context) (any, error) {
	settingsMutationMu.Lock()
	defer settingsMutationMu.Unlock()
	return currentDisplaySettings(), nil
}

// Isolated writes cannot change theme configuration, credentials or agent settings.
func updateDisplaySettings(c *gin.Context) (any, error) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256)
	var form struct {
		StatisticsSplit    *bool `json:"statistics_split"`
		DetailNetworkSplit *bool `json:"detail_network_split"`
	}
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&form); err != nil {
		return nil, err
	}
	var trailing any
	if decoder.Decode(&trailing) != io.EOF {
		return nil, errors.New("unexpected trailing JSON")
	}
	if form.StatisticsSplit == nil && form.DetailNetworkSplit == nil {
		return nil, errors.New("at least one display setting is required")
	}
	settingsMutationMu.Lock()
	defer settingsMutationMu.Unlock()
	previousStatistics, previousNetwork := singleton.Conf.StatisticsSplit, singleton.Conf.ShowNetworkInDetail
	previous := currentDisplaySettings()
	if form.StatisticsSplit != nil {
		singleton.Conf.StatisticsSplit = form.StatisticsSplit
	}
	if form.DetailNetworkSplit != nil {
		singleton.Conf.ShowNetworkInDetail = !*form.DetailNetworkSplit
	}
	if previous != currentDisplaySettings() {
		if err := singleton.Conf.Save(); err != nil {
			singleton.Conf.StatisticsSplit, singleton.Conf.ShowNetworkInDetail = previousStatistics, previousNetwork
			return nil, err
		}
	}
	return currentDisplaySettings(), nil
}
