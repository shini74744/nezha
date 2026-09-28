package controller

import (
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func TestNotificationEventTestServerAuthorizationAndCopy(t *testing.T) {
	defer setupTenancyTest(t)()
	oldConf := singleton.Conf
	singleton.Conf = &singleton.ConfigClass{Config: &model.Config{}}
	defer func() { singleton.Conf = oldConf }()
	require.NoError(t, singleton.DB.AutoMigrate(&model.Server{}))
	own := model.Server{Common: model.Common{ID: 12, UserID: 10}, Name: "Owned"}
	require.NoError(t, singleton.DB.Create(&own).Error)
	own.Host = &model.Host{MemTotal: 1024}
	own.State = &model.HostState{CPU: 2, MemUsed: 512}
	own.GeoIP = &model.GeoIP{IP: model.IP{IPv4Addr: "192.0.2.10", IPv6Addr: "2001:db8::10"}}
	singleton.ServerShared.Update(&own, "")
	n := &model.Notification{URL: "https://api.telegram.org/bot123:fake/sendMessage", RequestMethod: 2, RequestType: 1, RequestBody: `{"chat_id":1,"text":"#NEZHA# #SERVER.IP#"}`}
	ns := &model.NotificationServerBundle{Notification: n, Loc: time.UTC}
	f := &model.NotificationTestEvent{Kind: "online", ServerID: 12}
	_, _, err := prepareNotificationTest(ctxAs(99, model.RoleMember), ns, f)
	require.ErrorContains(t, err, "无权")
	prepared, _, err := prepareNotificationTest(ctxAs(10, model.RoleMember), ns, f)
	require.NoError(t, err)
	require.Equal(t, "Owned", prepared.Server.Name)
	require.NotEqual(t, "192.0.2.10", prepared.Server.GeoIP.IP.IPv4Addr)
	require.Equal(t, "192.0.2.10", own.GeoIP.IP.IPv4Addr)
	f.ServerID = 999
	_, _, err = prepareNotificationTest(ctxAs(10, model.RoleAdmin), ns, f)
	require.ErrorContains(t, err, "不存在")
	f.ServerID = 0
	prepared, _, err = prepareNotificationTest(ctxAs(10, model.RoleMember), ns, f)
	require.NoError(t, err)
	require.Equal(t, "示例服务器", prepared.Server.Name)
}
func TestEventTestDisabledCannotSaveButSkipCheckCan(t *testing.T) {
	defer setupTenancyTest(t)()
	f := model.NotificationForm{Name: "TG", URL: "https://api.telegram.org/bot123:fake/sendMessage", RequestMethod: 2, RequestType: 1,
		RequestBody: `{"chat_id":1,"text":"#NEZHA#"}`, TestEvent: &model.NotificationTestEvent{Kind: "offline"},
		EventTemplates: &model.NotificationEventConfig{Enabled: true, Modules: map[string]model.NotificationEventModule{"offline": {Mode: "disabled"}}}}
	_, err := createNotification(ctxAsMemberWithBody(10, f))
	require.ErrorContains(t, err, "不发送")
	var count int64
	require.NoError(t, singleton.DB.Model(&model.Notification{}).Count(&count).Error)
	require.Zero(t, count)
	f.SkipCheck = true
	_, err = createNotification(ctxAsMemberWithBody(10, f))
	require.NoError(t, err)
}
