package model

import (
	"github.com/goccy/go-json"
	"github.com/stretchr/testify/require"
	"net/url"
	"strings"
	"testing"
	"time"
	"unicode/utf16"
)

func eventTestNotification() Notification {
	return Notification{URL: "https://api.telegram.org/bot123:fake/sendMessage?custom=keep",
		RequestMethod: 2, RequestType: 1, RequestHeader: `{"X-Key":"keep"}`,
		RequestBody: `{"chat_id":-123,"message_thread_id":42,"parse_mode":"HTML","entities":[],"disable_notification":true,"text":"🚨 <b>#NEZHA#</b>","custom":"keep"}`,
		EventTemplates: &NotificationEventConfig{Enabled: true, Modules: map[string]NotificationEventModule{
			"online":    {Mode: "fields", Title: "🟢 服务器上线", Fields: []string{"server", "ip"}},
			"offline":   {Mode: "disabled"},
			"ip_change": {Mode: "fields", Fields: []string{"server", "old_ip", "new_ip"}},
		}}}
}
func TestEventModulesRenderAndKeepDeliverySettings(t *testing.T) {
	n := eventTestNotification()
	original := n.RequestBody
	ns := NotificationServerBundle{Notification: &n, Loc: time.UTC, Event: &NotificationEvent{Kind: "online", ServerName: "name <&> #NEZHA#", ServerID: 12, IP: "192.0.2.**"}}
	prepared, msg, skip, err := ns.prepareEvent("legacy 离线")
	require.NoError(t, err)
	require.False(t, skip)
	body, err := prepared.reqBody(msg)
	require.NoError(t, err)
	var b map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(body), &b))
	require.Equal(t, "🟢 服务器上线\n服务器：name <&> #NEZHA#（ID：12）\nIP：192.0.2.**", b["text"])
	require.Equal(t, float64(-123), b["chat_id"])
	require.Equal(t, float64(42), b["message_thread_id"])
	require.Equal(t, true, b["disable_notification"])
	require.Equal(t, "keep", b["custom"])
	require.NotContains(t, b, "parse_mode")
	require.NotContains(t, b, "entities")
	require.Equal(t, n.RequestHeader, prepared.Notification.RequestHeader)
	require.Equal(t, original, n.RequestBody)
}
func TestEventModulesIPChangeAndMissingData(t *testing.T) {
	n := eventTestNotification()
	ns := NotificationServerBundle{Notification: &n, Loc: time.UTC, Event: &NotificationEvent{Kind: "ip_change", ServerName: "示例", ServerID: 1, OldIP: "192.0.2.**", NewIP: "198.51.100.**"}}
	_, msg, _, err := ns.prepareEvent("legacy")
	require.NoError(t, err)
	require.Contains(t, msg, "旧 IP：192.0.2.**")
	require.Contains(t, msg, "新 IP：198.51.100.**")
	require.NotContains(t, msg, "#SERVER")
	n.EventTemplates.Modules["online"] = NotificationEventModule{Mode: "fields", Fields: []string{"cpu", "memory", "disk"}}
	ns.Event = &NotificationEvent{Kind: "online"}
	_, msg, _, err = ns.prepareEvent("legacy")
	require.NoError(t, err)
	require.Equal(t, "🟢 服务器上线", msg)
}
func TestEventModulesLegacyAndDisabled(t *testing.T) {
	n := eventTestNotification()
	ns := NotificationServerBundle{Notification: &n, Event: &NotificationEvent{Kind: "offline"}}
	_, _, skip, err := ns.prepareEvent("legacy")
	require.NoError(t, err)
	require.True(t, skip)
	require.True(t, n.EventDisabled("offline"))
	ns.Event.Kind = "other"
	got, msg, skip, err := ns.prepareEvent("legacy")
	require.NoError(t, err)
	require.Same(t, &ns, got)
	require.Equal(t, "legacy", msg)
	require.False(t, skip)
	ns.Event = nil
	_, msg, _, err = ns.prepareEvent("保存测试")
	require.NoError(t, err)
	require.Equal(t, "保存测试", msg)
	n.EventTemplates.Enabled = false
	require.False(t, n.EventDisabled("offline"))
	ns.Event = &NotificationEvent{Kind: "online"}
	got, _, _, err = ns.prepareEvent("legacy")
	require.NoError(t, err)
	require.Same(t, &ns, got)
}
func TestEventModulesGETAndForm(t *testing.T) {
	for _, method := range []uint8{1, 2} {
		t.Run(string(rune('0'+method)), func(t *testing.T) {
			n := eventTestNotification()
			n.RequestMethod = method
			n.RequestType = 2
			n.URL += "&chat_id=-42&text=#NEZHA#&parse_mode=HTML&entities=%5B%5D"
			n.RequestBody = `{"text":"#NEZHA#","chat_id":"-42","message_thread_id":"11"}`
			ns := NotificationServerBundle{Notification: &n, Loc: time.UTC, Event: &NotificationEvent{Kind: "online", ServerName: "test", ServerID: 1}}
			got, msg, _, err := ns.prepareEvent("legacy")
			require.NoError(t, err)
			u, err := url.Parse(got.reqURL(msg))
			require.NoError(t, err)
			require.Equal(t, "keep", u.Query().Get("custom"))
			require.Empty(t, u.Query().Get("parse_mode"))
			require.Empty(t, u.Query().Get("entities"))
			if method == 1 {
				require.Contains(t, u.Query().Get("text"), "服务器上线")
			} else {
				b, err := got.reqBody(msg)
				require.NoError(t, err)
				q, err := url.ParseQuery(b)
				require.NoError(t, err)
				require.Equal(t, "11", q.Get("message_thread_id"))
				require.Contains(t, q.Get("text"), "服务器上线")
			}
		})
	}
}
func TestEventModulesValidationAndLength(t *testing.T) {
	n := eventTestNotification()
	require.NoError(t, n.ValidateEventTemplates())
	for _, m := range []NotificationEventModule{
		{Mode: "bad"}, {Mode: "fields", Fields: []string{"unknown"}}, {Mode: "fields", Fields: []string{"ip", "ip"}},
		{Mode: "fields", Fields: []string{"old_ip"}}, {Mode: "fields", Title: strings.Repeat("a", 121)},
	} {
		n.EventTemplates.Modules["online"] = m
		require.Error(t, n.ValidateEventTemplates())
	}
	n = eventTestNotification()
	n.URL = "https://example.com/webhook"
	require.Error(t, n.ValidateEventTemplates())
	n = eventTestNotification()
	n.EventTemplates.Modules["online"] = NotificationEventModule{Mode: "fields", Fields: []string{"details"}}
	ns := NotificationServerBundle{Notification: &n, Event: &NotificationEvent{Kind: "online"}}
	_, msg, _, err := ns.prepareEvent(strings.Repeat("😀", 5000))
	require.NoError(t, err)
	require.LessOrEqual(t, len(utf16.Encode([]rune(msg))), 4096)
	require.Contains(t, msg, "内容已截断")
}

func TestIPHistoryFieldIsOrderedAndSpecificToIPEvents(t *testing.T) {
	n := &Notification{URL: "https://api.telegram.org/bot123:fake/sendMessage", RequestMethod: 2, RequestType: 1, RequestBody: `{"chat_id":1,"text":"#NEZHA#"}`,
		EventTemplates: &NotificationEventConfig{Enabled: true, Modules: map[string]NotificationEventModule{"ip_change": {Mode: "fields", Fields: []string{"new_ip", "old_ip", "ip_history"}}}}}
	require.NoError(t, n.ValidateEventTemplates())
	ns := &NotificationServerBundle{Notification: n, Event: &NotificationEvent{Kind: "ip_change", NewIP: "192.0.2.30", OldIP: "192.0.2.20", IPHistory: "1. 192.0.2.20  2026-09-28 14:00:00 +0800"}}
	text := ns.eventMessage("", n.EventTemplates.Modules["ip_change"])
	require.Contains(t, text, "新 IP：192.0.2.30\n旧 IP：192.0.2.20\n历史 IP")
	require.Contains(t, text, "2026-09-28 14:00:00 +0800")
	n.EventTemplates.Modules["offline"] = NotificationEventModule{Mode: "fields", Fields: []string{"ip_history"}}
	require.Error(t, n.ValidateEventTemplates())
}

func TestNotificationMbpsAndConnectionCounts(t *testing.T) {
	enabled := true
	n := eventTestNotification()
	n.FormatMetricUnits = &enabled
	ns := &NotificationServerBundle{Notification: &n, Loc: time.UTC, Server: &Server{Name: "test", Host: &Host{}, State: &HostState{NetInSpeed: 13951017, NetOutSpeed: 14062482, TcpConnCount: 123, UdpConnCount: 45}, GeoIP: &GeoIP{}}}
	require.Equal(t, "111.61 Mbps / 112.50 Mbps", ns.replaceParamsInString("#SERVER.SPEEDIN# / #SERVER.SPEEDOUT#", "", nil))
	require.Equal(t, "13951017", ns.replaceParamsInString("#SERVER.NETINSPEED#", "", nil))
	ns.Event = &NotificationEvent{Kind: "online"}
	message := ns.eventMessage("", NotificationEventModule{Fields: []string{"network", "tcp", "udp"}})
	require.Contains(t, message, "网速：↓111.61 Mbps | ↑112.50 Mbps")
	require.Contains(t, message, "TCP 连接数：123")
	require.Contains(t, message, "UDP 连接数：45")
	require.Equal(t, "0.00 Mbps", ns.formatSpeed(0))
	enabled = false
	require.Equal(t, "13951017 B/s", ns.formatSpeed(13951017))
}
