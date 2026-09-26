package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"net/http/httptest"
	"testing"
)

func TestAppearanceOnlyDefaultTheme(t *testing.T) {
	previous := singleton.Conf
	defer func() { singleton.Conf = previous }()
	singleton.Conf = &singleton.ConfigClass{Config: &model.Config{}}
	singleton.Conf.AppearanceConfig = "{\"version\":1,\"enabled\":true,\"features\":{}}"
	saved := singleton.Conf.AppearanceConfig
	for _, theme := range []string{"", "user-dist", "user-dist-other", "nezha-theme"} {
		singleton.Conf.UserTemplate = theme
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		response, err := listConfig(c)
		require.NoError(t, err)
		if theme == "" || theme == "user-dist" {
			require.Equal(t, saved, response.Config.AppearanceConfig)
		} else {
			require.Empty(t, response.Config.AppearanceConfig)
		}
		require.Equal(t, saved, singleton.Conf.AppearanceConfig, "switching themes must never delete the configuration")
		state := appearanceState()
		require.Equal(t, theme, state["current_template"])
	}
}
