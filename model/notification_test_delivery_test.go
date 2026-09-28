package model

import (
	"github.com/goccy/go-json"
	"github.com/stretchr/testify/require"
	"strings"
	"testing"
	"time"
)

func TestEventTestDeliveryUsesSelectedModuleAndNeverMutatesConfig(t *testing.T) {
	for kind, title := range NotificationEventTitles {
		t.Run(kind, func(t *testing.T) {
			n := &Notification{URL: "https://api.telegram.org/bot123:fake/sendMessage", RequestMethod: 2, RequestType: 1,
				RequestBody: `{"chat_id":"-100","message_thread_id":12,"text":"OLD #SERVER.NAME#","parse_mode":"HTML","custom":"keep"}`,
				EventTemplates: &NotificationEventConfig{Enabled: true, Modules: map[string]NotificationEventModule{
					kind: {Mode: "fields", Title: title, Fields: []string{"server", "ip", "details", "cpu", "memory"}},
				}},
			}
			if strings.HasPrefix(kind, "ddns_") {
				n.EventTemplates.Modules[kind] = NotificationEventModule{Mode: "fields", Title: title, Fields: []string{"domain", "result"}}
			}
			before, _ := json.Marshal(n)
			prepared, message, err := (&NotificationServerBundle{Notification: n, Loc: time.UTC}).PrepareEventTest(kind, nil)
			require.NoError(t, err)
			body, err := prepared.reqBody(message)
			require.NoError(t, err)
			var result map[string]interface{}
			require.NoError(t, json.Unmarshal([]byte(body), &result))
			text := result["text"].(string)
			require.Contains(t, text, "测试通知")
			require.Contains(t, text, title)
			require.NotContains(t, text, "#SERVER.")
			require.NotContains(t, text, "OLD")
			require.Equal(t, "-100", result["chat_id"])
			require.Equal(t, float64(12), result["message_thread_id"])
			require.Equal(t, "keep", result["custom"])
			if strings.HasPrefix(kind, "ddns_") {
				require.Contains(t, text, "未修改 DNS 记录")
			}
			after, _ := json.Marshal(n)
			require.Equal(t, string(before), string(after))
			require.Nil(t, prepared.Event)
		})
	}
}
func TestEventTestInheritanceGetDisabledAndUnknown(t *testing.T) {
	n := &Notification{URL: "https://api.telegram.org/bot123:fake/sendMessage", RequestMethod: 2, RequestType: 1,
		RequestBody: `{"chat_id":1,"text":"#SERVER.NAME# #SERVER.IPV4# #SERVER.IPV6# #SERVER.CPU# #SERVER.MEM# #SERVER.DISK# #SERVER.LOAD1# #SERVER.NETINSPEED#"}`}
	ns := &NotificationServerBundle{Notification: n, Loc: time.UTC}
	p, m, e := ns.PrepareEventTest("online", nil)
	require.NoError(t, e)
	body, e := p.reqBody(m)
	require.NoError(t, e)
	require.Contains(t, body, "测试通知")
	require.Contains(t, body, "示例服务器")
	require.Contains(t, body, "2001:db8::10")
	require.NotContains(t, body, "#SERVER.")
	n.RequestMethod = 1
	n.URL += "?chat_id=1&text=%23SERVER.NAME%23"
	p, m, e = ns.PrepareEventTest("offline", nil)
	require.NoError(t, e)
	require.NotContains(t, p.reqURL(m), "SERVER.NAME")
	require.Contains(t, p.reqURL(m), "%E6%B5%8B%E8%AF%95")
	n.EventTemplates = &NotificationEventConfig{Enabled: true, Modules: map[string]NotificationEventModule{"offline": {Mode: "disabled"}}}
	_, _, e = ns.PrepareEventTest("offline", nil)
	require.ErrorContains(t, e, "不发送")
	_, _, e = ns.PrepareEventTest("unknown", nil)
	require.ErrorContains(t, e, "未知")
	_, _, e = ns.PrepareEventTest("online", &Server{})
	require.ErrorContains(t, e, "尚无完整")
}

func TestIPHistoryTestUsesSamplesOrReadOnlyOverride(t *testing.T) {
	n := &Notification{URL: "https://api.telegram.org/bot123:fake/sendMessage", RequestMethod: 2, RequestType: 1, RequestBody: `{"chat_id":1,"text":"#NEZHA#"}`,
		EventTemplates: &NotificationEventConfig{Enabled: true, Modules: map[string]NotificationEventModule{"ip_change": {Mode: "fields", Fields: []string{"new_ip", "old_ip", "ip_history"}}}}}
	ns := &NotificationServerBundle{Notification: n, Loc: time.UTC}
	p, m, e := ns.PrepareEventTest("ip_change", nil)
	require.NoError(t, e)
	body, e := p.reqBody(m)
	require.NoError(t, e)
	require.Contains(t, body, "7. 192.0.2.26")
	require.NotContains(t, body, "8. 192.0.2.27")
	p, m, e = ns.PrepareEventTest("ip_change", nil, "暂无记录")
	require.NoError(t, e)
	body, e = p.reqBody(m)
	require.NoError(t, e)
	require.Contains(t, body, "暂无记录")
	require.NotContains(t, body, "7. 192.0.2.26")
}
