package singleton

import (
	"fmt"
	"github.com/nezhahq/nezha/model"
)

func alertNotification(alert *model.AlertRule, server *model.Server, recovered bool) (string, model.NotificationEvent) {
	kind, label := "alert", Localizer.T("Incident")
	if recovered {
		kind, label = "alert_recovery", Localizer.T("Resolved")
	}
	offline := len(alert.Rules) > 0
	for _, r := range alert.Rules {
		if r == nil || !r.IsOfflineRule() {
			offline = false
		}
	}
	ip := ""
	if server.GeoIP != nil {
		ip = IPDesensitize(server.GeoIP.IP.Join())
	}
	event := model.NotificationEvent{Kind: kind, ServerName: server.Name, ServerID: server.ID, IP: ip, RuleName: alert.Name}
	if offline {
		state := "服务器已离线"
		event.Kind = "offline"
		label = "离线"
		if recovered {
			state = "服务器已恢复在线"
			event.Kind = "online"
			label = "上线"
		}
		return fmt.Sprintf("[%s] %s(%s) %s", label, server.Name, ip, state), event
	}
	return fmt.Sprintf("[%s] %s(%s) %s", label, server.Name, ip, alert.Name), event
}
