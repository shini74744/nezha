package networkinsight

import (
	"encoding/json"
	"errors"
	"github.com/nezhahq/nezha/service/connectivity"
	"gorm.io/gorm"
	"net/netip"
	"regexp"
	"strings"
	"unicode/utf8"
)

type ReturnTarget struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Carrier string `json:"carrier"`
	IPv4    string `json:"ipv4"`
	IPv6    string `json:"ipv6"`
	Enabled bool   `json:"enabled"`
}
type ReturnPolicy struct {
	connectivity.Policy `gorm:"embedded"`
	Protocol            string         `json:"protocol"`
	Targets             []ReturnTarget `json:"targets" gorm:"serializer:json"`
}

func (ReturnPolicy) TableName() string { return "return_route_policies" }
func DefaultReturnPolicy() ReturnPolicy {
	return ReturnPolicy{Policy: connectivity.Policy{ID: 1, Enabled: false, IntervalHours: 6, RetentionDays: 1}, Protocol: "tcp", Targets: []ReturnTarget{
		{"bj-ct", "北京", "电信", "106.37.68.13", "240e:904:800:1f80::b00:137", true},
		{"bj-cu", "北京", "联通", "221.222.185.232", "2408:8706:0:dd80::b00:90", true},
		{"bj-cm", "北京", "移动", "211.136.25.153", "2409:8c10:c00:1b:8000:0:b00:181", true},
		{"sh-ct", "上海", "电信", "101.226.101.195", "240e:96c:6000:d80::b00:40", true},
		{"sh-cu", "上海", "联通", "58.246.163.108", "2408:873c:6810:5:8000:0:b00:221", true},
		{"sh-cm", "上海", "移动", "117.185.117.117", "2409:8c1e:75b0:2003:8000:0:b00:319", true},
		{"gd-ct", "广州", "电信", "14.22.119.35", "240e:93c:209:2:8000:0:b00:59", true},
		{"gd-cu", "广州", "联通", "122.13.24.8", "2408:8756:dcff:e001:8000:0:b00:99", true},
		{"gd-cm", "广州", "移动", "211.139.145.129", "2409:8c54:810:a36:8000:0:b00:60", true},
	}}
}

var returnTargetID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,40}$`)

func (p ReturnPolicy) Validate() error {
	if err := p.Policy.Validate(); err != nil {
		return err
	}
	if p.Protocol != "tcp" && p.Protocol != "icmp" && p.Protocol != "udp" {
		return errors.New("回程协议须为 TCP、ICMP 或 UDP")
	}
	if len(p.Targets) < 1 || len(p.Targets) > 12 {
		return errors.New("回程检测点须为 1–12 个")
	}
	seen := map[string]bool{}
	for _, t := range p.Targets {
		if !returnTargetID.MatchString(t.ID) || seen[t.ID] {
			return errors.New("回程检测点标识无效或重复")
		}
		seen[t.ID] = true
		if strings.TrimSpace(t.Name) == "" || utf8.RuneCountInString(t.Name) > 30 || strings.TrimSpace(t.Carrier) == "" || utf8.RuneCountInString(t.Carrier) > 20 {
			return errors.New("请填写有效地区和运营商名称")
		}
		if t.IPv4 == "" && t.IPv6 == "" {
			return errors.New("检测点至少填写一个公网 IP")
		}
		for _, v := range []struct {
			ip string
			v4 bool
		}{{t.IPv4, true}, {t.IPv6, false}} {
			if v.ip == "" {
				continue
			}
			ip, err := netip.ParseAddr(v.ip)
			if err != nil || ip.Zone() != "" || ip.Is4In6() || ip.Is4() != v.v4 || !ReturnPublicIP(v.ip) {
				return errors.New("检测目标仅允许对应协议的公网 IP，不支持域名、内网或命令")
			}
		}
	}
	return nil
}
func ReadReturnPolicy(db *gorm.DB) (ReturnPolicy, error) {
	p := DefaultReturnPolicy()
	if db == nil {
		return p, nil
	}
	err := db.Where("id = ?", 1).Limit(1).Find(&p).Error
	return p, err
}

type ReturnHop struct {
	TTL          int      `json:"ttl"`
	IP           string   `json:"ip,omitempty"`
	ASN          string   `json:"asn,omitempty"`
	Location     string   `json:"location,omitempty"`
	Organization string   `json:"organization,omitempty"`
	RTT          *float64 `json:"rtt_ms,omitempty"`
	Samples      int      `json:"samples"`
	Country      string   `json:"country,omitempty"`
	Network      string   `json:"network,omitempty"`
	Stage        string   `json:"stage,omitempty"`
	IPHidden     bool     `json:"ip_hidden,omitempty"`
	Latitude     *float64 `json:"latitude,omitempty"`
	Longitude    *float64 `json:"longitude,omitempty"`
}
type ReturnResult struct {
	ID            string      `json:"id"`
	Name          string      `json:"name"`
	Carrier       string      `json:"carrier"`
	Family        string      `json:"family"`
	Target        string      `json:"target,omitempty"`
	ComparisonKey string      `json:"comparison_key,omitempty"`
	TestedAt      int64       `json:"tested_at,omitempty"`
	Protocol      string      `json:"protocol"`
	Status        string      `json:"status"`
	Route         []string    `json:"route,omitempty"`
	Hops          []ReturnHop `json:"hops,omitempty"`
	Line          string      `json:"line,omitempty"`
	Confidence    string      `json:"confidence,omitempty"`
	Evidence      []string    `json:"evidence,omitempty"`
}

func EmptyReturnRoutes(p ReturnPolicy, families []string) []ReturnResult {
	results := []ReturnResult{}
	for _, f := range families {
		for _, t := range p.Targets {
			if !t.Enabled {
				continue
			}
			ip := t.IPv4
			if f == "IPv6" {
				ip = t.IPv6
			}
			if ip != "" {
				results = append(results, ReturnResult{ID: t.ID, Name: t.Name, Carrier: t.Carrier, Family: f, Target: ip, Protocol: p.Protocol, Status: "pending"})
			}
		}
	}
	return results
}

// Running probes depend on target/protocol, not scheduling or retention changes.
// Automation enablement is checked separately; a manual promotion survives it.
func ReturnPolicyFingerprint(p ReturnPolicy) string {
	raw, _ := json.Marshal(struct {
		Protocol string
		Targets  []ReturnTarget
	}{p.Protocol, p.Targets})
	return string(raw)
}

func ReturnPublicIP(value string) bool {
	if !PublicIP(value) {
		return false
	}
	ip, err := netip.ParseAddr(value)
	if err != nil || ip.Zone() != "" || ip.Is4In6() {
		return false
	}
	for _, block := range []string{"0.0.0.0/8", "192.0.0.0/24", "192.88.99.0/24", "240.0.0.0/4", "2001::/32", "2001:10::/28", "2001:20::/28", "2002::/16"} {
		if netip.MustParsePrefix(block).Contains(ip) {
			return false
		}
	}
	return ip.Is4() || netip.MustParsePrefix("2000::/3").Contains(ip)
}
