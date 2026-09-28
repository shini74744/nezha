package singleton

import (
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/i18n"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestAlertEventKindAndRecoveryWording(t *testing.T) {
	oldConf, oldLocalizer := Conf, Localizer
	defer func() { Conf, Localizer = oldConf, oldLocalizer }()
	Conf = &ConfigClass{Config: &model.Config{}}
	Localizer = i18n.NewLocalizer("zh_CN", domain, "translations", i18n.Translations)
	server := &model.Server{Common: model.Common{ID: 12}, Name: "测试机器", GeoIP: &model.GeoIP{IP: model.IP{IPv4Addr: "192.0.2.10"}}}
	alert := &model.AlertRule{Name: "离线", Rules: []*model.Rule{{Type: "offline", Duration: 30}}}
	msg, event := alertNotification(alert, server, false)
	require.Equal(t, "offline", event.Kind)
	require.Contains(t, msg, "[离线]")
	require.Equal(t, "离线", event.RuleName)
	msg, event = alertNotification(alert, server, true)
	require.Equal(t, "online", event.Kind)
	require.Contains(t, msg, "[上线]")
	require.NotContains(t, msg, "离线")
	require.NotEqual(t, "192.0.2.10", event.IP)
	alert.Rules = []*model.Rule{{Type: "cpu", Duration: 30}}
	_, event = alertNotification(alert, server, false)
	require.Equal(t, "alert", event.Kind)
	_, event = alertNotification(alert, server, true)
	require.Equal(t, "alert_recovery", event.Kind)
	// Classification must not depend on the user naming a CPU rule "离线".
	alert.Rules = append(alert.Rules, &model.Rule{Type: "offline", Duration: 30})
	_, event = alertNotification(alert, server, true)
	require.Equal(t, "alert_recovery", event.Kind)
}
