package controller

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
)

func prepareNotificationTest(c *gin.Context, ns *model.NotificationServerBundle, test *model.NotificationTestEvent) (*model.NotificationServerBundle, string, error) {
	if test == nil {
		return ns, singleton.Localizer.T("a test message"), nil
	}
	var server *model.Server
	var ipHistory []string
	if test.ServerID != 0 {
		var stored model.Server
		if err := singleton.DB.First(&stored, test.ServerID).Error; err != nil || !stored.HasPermission(c) {
			return nil, "", fmt.Errorf("无权使用此服务器或服务器不存在")
		}
		if singleton.ServerShared == nil {
			return nil, "", fmt.Errorf("服务器数据暂不可用")
		}
		live, ok := singleton.ServerShared.Get(test.ServerID)
		if !ok || live.GetUserID() != stored.GetUserID() {
			return nil, "", fmt.Errorf("服务器数据暂不可用")
		}
		if test.Kind == "ip_change" {
			history, err := singleton.ReadServerIPHistory(stored.UUID)
			if err != nil {
				return nil, "", fmt.Errorf("历史 IP 读取失败，请稍后再试")
			}
			ipHistory = []string{singleton.FormatIPHistory(history)}
		}
		runtime := live.RuntimeSnapshot()
		// Use only authorized, copied metadata and a runtime snapshot.
		server = &model.Server{Common: stored.Common, Name: stored.Name, Host: runtime.Host, State: runtime.State}
		if live.GeoIP != nil {
			ip := live.GeoIP.IP
			server.GeoIP = &model.GeoIP{IP: model.IP{IPv4Addr: singleton.IPDesensitize(ip.IPv4Addr), IPv6Addr: singleton.IPDesensitize(ip.IPv6Addr)}}
		}
	}
	return ns.PrepareEventTest(test.Kind, server, ipHistory...)
}
