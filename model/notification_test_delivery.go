package model

import (
	"fmt"
	"github.com/goccy/go-json"
	"regexp"
	"strings"
	"time"
)

var telegramPlaceholderEscape = regexp.MustCompile(`%23([A-Z][A-Z0-9.]*?)%23`)

// PrepareEventTest renders through the same module path as real events, on copies only.
// A nil server uses documentation-only addresses and simulated metrics.
func (ns *NotificationServerBundle) PrepareEventTest(kind string, server *Server, historyOverride ...string) (*NotificationServerBundle, string, error) {
	title, ok := NotificationEventTitles[kind]
	if !ok {
		return nil, "", fmt.Errorf("未知测试事件类型")
	}
	if ns.Notification.EventDisabled(kind) {
		return nil, "", fmt.Errorf("当前状态设为不发送，请先调整处理方式或仅保存")
	}
	source := "模拟数据"
	if server == nil {
		server = &Server{Common: Common{ID: 12}, Name: "示例服务器",
			Host:  &Host{MemTotal: 8 << 30, DiskTotal: 80 << 30},
			State: &HostState{CPU: 85.25, MemUsed: 4 << 30, DiskUsed: 20 << 30, NetInSpeed: 1048576, NetOutSpeed: 524288, NetInTransfer: 1000000000, NetOutTransfer: 512000000, Load1: 0.5, Load5: 0.4, Load15: 0.3, TcpConnCount: 16, UdpConnCount: 4},
			GeoIP: &GeoIP{IP: IP{IPv4Addr: "192.0.2.10", IPv6Addr: "2001:db8::10"}},
		}
	} else {
		source = "指定服务器快照，事件为模拟"
	}
	runtime := server.RuntimeSnapshot()
	if runtime.Host == nil || runtime.State == nil {
		return nil, "", fmt.Errorf("服务器尚无完整上报数据，请选择模拟数据")
	}
	e := &NotificationEvent{Kind: kind, ServerName: server.Name, ServerID: server.ID, RuleName: "模拟规则"}
	if server.GeoIP != nil {
		e.IP = server.GeoIP.IP.Join()
	}
	details := map[string]string{
		"offline": "服务器已离线", "online": "服务器已恢复在线",
		"alert": "CPU 高负载触发告警", "alert_recovery": "CPU 高负载已恢复正常",
		"service_alert": "服务连接超时", "service_recovery": "服务已恢复正常",
		"task_success": "任务执行成功（未实际执行任务）", "task_failure": "任务执行失败（未实际执行任务）",
		"tls": "证书将在七天内到期", "other": "其他系统事件",
		"ip_change":    "IP 地址变更（未实际变更地址）",
		"ddns_success": "DDNS 更新成功（未修改 DNS 记录）", "ddns_failure": "DDNS 更新失败（未修改 DNS 记录）",
	}
	if kind == "ip_change" {
		var lines []string
		loc := ns.Loc
		if loc == nil {
			loc = time.Local
		}
		for i := 0; i < 7; i++ {
			lines = append(lines, fmt.Sprintf("%d. 192.0.2.%d/2001:db8::%d  %s", i+1, 20+i, 20+i, time.Now().In(loc).Add(-time.Duration(i+1)*time.Hour).Format("2006-01-02 15:04:05 -0700")))
		}
		e.IPHistory = strings.Join(lines, "\n")
		if len(historyOverride) > 0 {
			e.IPHistory = historyOverride[0]
		}
		e.OldIP = "192.0.2.20/2001:db8::20"
		e.NewIP = e.IP
		e.RuleName = ""
	}
	if strings.HasPrefix(kind, "ddns_") {
		e.RuleName = "模拟 DDNS 配置"
		e.Domain = "example.com"
		e.RecordType = "A"
		e.TargetIP = "192.0.2.10"
		e.Result = "模拟成功：更新请求执行成功，未修改 DNS 记录"
		if kind == "ddns_failure" {
			e.Result = "模拟失败：已用尽重试次数，未修改 DNS 记录"
		}
	}
	input := *ns
	input.Server = server
	input.Event = e
	prepared, message, skip, err := input.prepareEvent(details[kind])
	if err != nil {
		return nil, "", err
	}
	if skip {
		return nil, "", fmt.Errorf("当前状态不发送")
	}
	// Prefix the final Telegram text, even when an inherited template omits NEZHA.
	u, b, err := prepared.Notification.telegramEventRequest()
	if err != nil {
		return nil, "", err
	}
	label := "测试通知 · " + title + " · " + source + "\n"
	q := u.Query()
	n := *prepared.Notification
	if n.RequestMethod == NotificationRequestMethodGET {
		q.Set("text", label+q.Get("text"))
	} else {
		bodyText, ok := b["text"].(string)
		if !ok {
			return nil, "", fmt.Errorf("Telegram text 必须为字符串")
		}
		b["text"] = label + bodyText
		delete(b, "entities")
		encoded, err := json.Marshal(b)
		if err != nil {
			return nil, "", err
		}
		n.RequestBody = string(encoded)
	}
	q.Del("entities")
	u.RawQuery = q.Encode()
	n.URL = regexpPlaceholderURL(u.String())
	output := *prepared
	output.Notification = &n
	output.Event = nil // Already rendered: never run an event module twice.
	// Legacy replacement requires GeoIP, including on servers without a known address.
	if output.Server != nil && output.Server.GeoIP == nil {
		output.Server = output.Server.RuntimeCopy(output.Server.RuntimeSnapshot())
		output.Server.GeoIP = &GeoIP{}
	}
	return &output, message, nil
}

func regexpPlaceholderURL(raw string) string {
	return telegramPlaceholderEscape.ReplaceAllString(raw, "#$1#")
}
