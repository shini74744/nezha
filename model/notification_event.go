package model

import (
	"fmt"
	"github.com/goccy/go-json"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// Event metadata is supplied by the producer, not parsed from localized text.
// IPs follow the dashboard's notification masking policy before entering here.
type NotificationEvent struct {
	Kind       string
	ServerName string
	ServerID   uint64
	IP         string
	RuleName   string
	IPHistory  string
	OldIP      string
	NewIP      string
	Domain     string
	RecordType string
	TargetIP   string
	Result     string
}
type NotificationEventModule struct {
	Mode   string   `json:"mode"`
	Title  string   `json:"title"`
	Fields []string `json:"fields"`
}
type NotificationEventConfig struct {
	Enabled bool                               `json:"enabled"`
	Modules map[string]NotificationEventModule `json:"modules"`
}

var NotificationEventTitles = map[string]string{
	"offline": "🔴 服务器离线", "online": "🟢 服务器上线",
	"server_expiry": "⏰ 服务器到期通知",
	"ip_change":     "🌐 IP 地址变更", "alert": "⚠️ 资源告警", "alert_recovery": "✅ 资源告警恢复",
	"service_alert": "🔴 服务异常", "service_recovery": "🟢 服务恢复",
	"tls": "🔐 TLS 证书通知", "task_success": "✅ 任务执行成功",
	"task_failure": "❌ 任务执行失败", "other": "🔔 其他通知",
	"ddns_success": "✅ DDNS 更新成功", "ddns_failure": "❌ DDNS 更新失败",
}
var notificationEventFields = map[string]bool{
	"time": true, "server": true, "ip": true, "rule": true, "details": true,
	"old_ip": true, "new_ip": true, "ip_history": true, "cpu": true, "memory": true, "disk": true,
	"network": true, "transfer": true, "load": true, "tcp": true, "udp": true,
	"domain": true, "record_type": true, "target_ip": true, "result": true,
}
var telegramEventPath = regexp.MustCompile(`/bot[^/]+/sendMessage$`)

func (n *Notification) ValidateEventTemplates() error {
	c := n.EventTemplates
	if c == nil {
		return nil
	}
	if len(c.Modules) > len(NotificationEventTitles) {
		return fmt.Errorf("通知模块数量无效")
	}
	for kind, m := range c.Modules {
		if _, ok := NotificationEventTitles[kind]; !ok {
			return fmt.Errorf("未知通知事件类型")
		}
		if m.Mode != "inherit" && m.Mode != "fields" && m.Mode != "disabled" {
			return fmt.Errorf("通知模块模式无效")
		}
		if utf8.RuneCountInString(m.Title) > 120 || strings.ContainsAny(m.Title, "\r\n") {
			return fmt.Errorf("模块标题须为单行且不超过 120 字符")
		}
		if len(m.Fields) > len(notificationEventFields) {
			return fmt.Errorf("模块字段过多")
		}
		seen := map[string]bool{}
		for _, field := range m.Fields {
			if !notificationEventFields[field] || seen[field] {
				return fmt.Errorf("模块字段无效或重复")
			}
			if (field == "old_ip" || field == "new_ip" || field == "ip_history") && kind != "ip_change" {
				return fmt.Errorf("旧/新 IP 和历史 IP 仅用于 IP 变更事件")
			}
			if (field == "domain" || field == "record_type" || field == "target_ip" || field == "result") && kind != "ddns_success" && kind != "ddns_failure" {
				return fmt.Errorf("域名/记录/结果字段仅用于 DDNS 事件")
			}
			seen[field] = true
		}
	}
	if c.Enabled {
		if _, _, err := n.telegramEventRequest(); err != nil {
			return err
		}
	}
	return nil
}

// Leave generic webhooks and legacy Telegram payloads unchanged unless explicitly enabled.
func (n *Notification) telegramEventRequest() (*url.URL, map[string]interface{}, error) {
	raw := regexp.MustCompile(`#[A-Z][A-Z0-9.]*#`).ReplaceAllStringFunc(n.URL, url.QueryEscape)
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || !telegramEventPath.MatchString(u.Path) {
		return nil, nil, fmt.Errorf("事件模块仅支持 Telegram sendMessage")
	}
	b := map[string]interface{}{}
	if n.RequestMethod == NotificationRequestMethodPOST {
		if n.RequestType != NotificationRequestTypeJSON && n.RequestType != NotificationRequestTypeForm {
			return nil, nil, fmt.Errorf("事件模块请求类型无效")
		}
		if err = json.Unmarshal([]byte(n.RequestBody), &b); err != nil || b == nil {
			return nil, nil, fmt.Errorf("事件模块请求正文必须为 JSON 对象")
		}
	} else if n.RequestMethod != NotificationRequestMethodGET {
		return nil, nil, fmt.Errorf("事件模块请求方法无效")
	}
	return u, b, nil
}

func (n *Notification) EventDisabled(kind string) bool {
	return n.EventTemplates != nil && n.EventTemplates.Enabled && n.EventTemplates.Modules[kind].Mode == "disabled"
}
func (ns *NotificationServerBundle) eventMessage(original string, m NotificationEventModule) string {
	e := ns.Event
	title := strings.TrimSpace(m.Title)
	if title == "" {
		title = NotificationEventTitles[e.Kind]
	}
	values := map[string]string{"details": "详情：" + original}
	if e.Domain != "" {
		values["domain"] = "域名：" + e.Domain
	}
	if e.RecordType != "" {
		values["record_type"] = "记录类型：" + e.RecordType
	}
	if e.TargetIP != "" {
		values["target_ip"] = "目标 IP：" + e.TargetIP
	}
	if e.Result != "" {
		values["result"] = "结果：" + e.Result
	}
	loc := ns.Loc
	if loc == nil {
		loc = time.Local
	}
	values["time"] = "时间：" + time.Now().In(loc).Format("2006-01-02 15:04:05 -0700")
	name, id := e.ServerName, e.ServerID
	if ns.Server != nil {
		name, id = ns.Server.Name, ns.Server.ID
	}
	if name != "" {
		values["server"] = fmt.Sprintf("服务器：%s（ID：%d）", name, id)
	}
	if e.IP != "" {
		values["ip"] = "IP：" + e.IP
	}
	if e.RuleName != "" {
		values["rule"] = "规则：" + e.RuleName
	}
	if e.OldIP != "" {
		values["old_ip"] = "旧 IP：" + e.OldIP
	}
	if e.NewIP != "" {
		values["new_ip"] = "新 IP：" + e.NewIP
	}
	if e.Kind == "ip_change" {
		history := e.IPHistory
		if history == "" {
			history = "暂无记录"
		}
		values["ip_history"] = "历史 IP（最近 7 次，时间为变更时间）：\n" + history
	}
	if ns.Server != nil {
		runtime := ns.Server.RuntimeSnapshot()
		if runtime.State != nil && runtime.Host != nil {
			s, h := runtime.State, runtime.Host
			ratio := func(used, total uint64) string {
				if total == 0 {
					return "无数据"
				}
				return ns.formatUsage(true, float64(used)/float64(total))
			}
			values["cpu"] = "CPU：" + ns.formatUsage(false, s.CPU)
			values["memory"] = "内存：" + ratio(s.MemUsed, h.MemTotal)
			values["disk"] = "磁盘：" + ratio(s.DiskUsed, h.DiskTotal)
			values["network"] = fmt.Sprintf("网速：↓%s | ↑%s", ns.formatSpeed(s.NetInSpeed), ns.formatSpeed(s.NetOutSpeed))
			values["transfer"] = fmt.Sprintf("累计流量：↓%s | ↑%s", ns.formatSize(s.NetInTransfer), ns.formatSize(s.NetOutTransfer))
			values["tcp"] = fmt.Sprintf("TCP 连接数：%d", s.TcpConnCount)
			values["udp"] = fmt.Sprintf("UDP 连接数：%d", s.UdpConnCount)
			values["load"] = fmt.Sprintf("负载：%.2f / %.2f / %.2f", s.Load1, s.Load5, s.Load15)
		}
	}
	lines := []string{title}
	for _, key := range m.Fields {
		if v := values[key]; v != "" {
			lines = append(lines, v)
		}
	}
	// Telegram text is limited to 4096 Unicode characters; keep a UTF-16-safe budget.
	result := strings.Join(lines, "\n")
	units := 0
	for i, r := range result {
		step := 1
		if r > 0xffff {
			step = 2
		}
		units += step
		if units > 3900 {
			return result[:i] + "\n…（内容已截断）"
		}
	}
	return result
}

// Modules use plain text so server names / command output cannot inject HTML or
// Markdown. Credentials, chat, topic, silence and unrelated request fields survive.
func (ns *NotificationServerBundle) prepareEvent(original string) (*NotificationServerBundle, string, bool, error) {
	n := ns.Notification
	if ns.Event == nil || n.EventTemplates == nil || !n.EventTemplates.Enabled {
		return ns, original, false, nil
	}
	m, ok := n.EventTemplates.Modules[ns.Event.Kind]
	if !ok || m.Mode == "inherit" {
		return ns, original, false, nil
	}
	if m.Mode == "disabled" {
		return ns, original, true, nil
	}
	if err := n.ValidateEventTemplates(); err != nil {
		return ns, original, false, err
	}
	u, b, err := n.telegramEventRequest()
	if err != nil {
		return ns, original, false, err
	}
	q := u.Query()
	q.Del("parse_mode")
	q.Del("entities")
	q.Del("text")
	delete(b, "parse_mode")
	delete(b, "entities")
	if n.RequestMethod == NotificationRequestMethodGET {
		q.Set("text", "#NEZHA#")
	} else {
		b["text"] = "#NEZHA#"
	}
	u.RawQuery = q.Encode()
	copyN := *n
	copyN.URL = regexp.MustCompile(`%23([A-Z][A-Z0-9.]*?)%23`).ReplaceAllString(u.String(), "#$1#")
	if n.RequestMethod == NotificationRequestMethodPOST {
		encoded, err := json.Marshal(b)
		if err != nil {
			return ns, original, false, err
		}
		copyN.RequestBody = string(encoded)
	}
	copyNS := *ns
	copyNS.Notification = &copyN
	// The rendered text already contains all selected data; avoid requiring live
	// host/state just to replace NEZHA for IP / service / first-contact events.
	copyNS.Server = nil
	return &copyNS, ns.eventMessage(original, m), false, nil
}
