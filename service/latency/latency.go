// Package latency stores administrator-configured TCP probes and their history.
package latency

import (
	"encoding/json"
	"errors"
	"github.com/nezhahq/nezha/service/connectivity"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"net"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type Target struct {
	ID       string  `json:"id"`
	Region   string  `json:"region"`
	Province string  `json:"province"`
	Carrier  string  `json:"carrier"`
	Host     string  `json:"host"`
	Port     int     `json:"port"`
	Enabled  bool    `json:"enabled"`
	IPv6Host *string `json:"ipv6_host,omitempty"`
}
type Settings struct {
	ID            uint     `json:"-" gorm:"primaryKey"`
	Enabled       bool     `json:"enabled"`
	IntervalHours int      `json:"interval_hours"`
	RetentionDays int      `json:"retention_days"`
	Targets       []Target `json:"targets" gorm:"serializer:json"`
}

func (Settings) TableName() string { return "latency_settings" }
func Defaults() Settings {
	s := Settings{ID: 1, IntervalHours: 2, RetentionDays: 1}
	groups := [][]string{
		{"华东", "ah:安徽", "fj:福建", "js:江苏", "jx:江西", "sd:山东", "sh:上海", "zj:浙江"},
		{"华北", "bj:北京", "he:河北", "nm:内蒙古", "sx:山西", "tj:天津"},
		{"华南", "gd:广东", "gx:广西", "hi:海南"}, {"华中", "ha:河南", "hb:湖北", "hn:湖南"},
		{"西南", "cq:重庆", "gz:贵州", "sc:四川", "xz:西藏", "yn:云南"},
		{"西北", "gs:甘肃", "nx:宁夏", "qh:青海", "sn:陕西", "xj:新疆"}, {"东北", "hl:黑龙江", "jl:吉林", "ln:辽宁"}}
	for _, g := range groups {
		for _, p := range g[1:] {
			v := strings.Split(p, ":")
			for _, c := range []string{"ct:电信", "cu:联通", "cm:移动"} {
				w := strings.Split(c, ":")
				id := v[0] + "-" + w[0]
				s.Targets = append(s.Targets, Target{ID: id, Region: g[0], Province: v[1], Carrier: w[1], Host: id + "-v4.ip.zstaticcdn.com", Port: 80, Enabled: true})
			}
		}
	}
	return s
}

var identifier = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)
var hostname = regexp.MustCompile(`^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$`)

func PublicIP(ip net.IP) bool {
	return ip != nil && ip.IsGlobalUnicast() && !ip.IsPrivate() && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() && !ip.IsUnspecified() &&
		!(ip.To4() != nil && (ip.To4()[0] == 0 || ip.To4()[0] >= 224 || (ip.To4()[0] == 100 && ip.To4()[1] >= 64 && ip.To4()[1] <= 127)))
}
func (s Settings) Validate() error {
	if s.IntervalHours < 1 || s.IntervalHours > 24 || s.RetentionDays < 1 || s.RetentionDays > 30 {
		return errors.New("检测间隔须为 1–24 小时，保留时间须为 1–30 天")
	}
	if len(s.Targets) > 128 {
		return errors.New("最多设置 128 个检测地址")
	}
	ids := map[string]bool{}
	for _, t := range s.Targets {
		if !identifier.MatchString(t.ID) || ids[t.ID] {
			return errors.New("检测地址标识无效或重复")
		}
		ids[t.ID] = true
		for _, v := range []string{t.Region, t.Province, t.Carrier} {
			if strings.TrimSpace(v) == "" || len(v) > 64 {
				return errors.New("地区和运营商不能为空或过长")
			}
		}
		if t.Port < 1 || t.Port > 65535 {
			return errors.New("端口须为 1–65535")
		}
		if t.IPv6Host != nil && *t.IPv6Host != "" {
			host := *t.IPv6Host
			if ip := net.ParseIP(host); ip != nil {
				if !PublicIP(ip) || ip.To4() != nil {
					return errors.New("IPv6 地址须为公网 IPv6")
				}
			} else if len(host) > 253 || !hostname.MatchString(host) || strings.HasSuffix(strings.ToLower(host), ".local") || strings.HasSuffix(strings.ToLower(host), ".localhost") {
				return errors.New("请填写有效的 IPv6 域名或地址")
			}
		}
		if ip := net.ParseIP(t.Host); ip != nil {
			if !PublicIP(ip) {
				return errors.New("请使用公网检测地址")
			}
		} else if len(t.Host) > 253 || !hostname.MatchString(t.Host) || strings.HasSuffix(strings.ToLower(t.Host), ".local") || strings.HasSuffix(strings.ToLower(t.Host), ".localhost") {
			return errors.New("请填写公网 IP 或域名，不含协议和路径")
		}
	}
	return nil
}
func Read(db *gorm.DB) (Settings, error) {
	s := Defaults()
	if db == nil {
		return s, nil
	}
	e := db.Where("id = ?", 1).Limit(1).Find(&s).Error
	return s, e
}

// Nil is a legacy catalog entry: derive IPv6 only for the exact built-in host.
// An explicitly saved empty string disables IPv6 for this target.
func (t Target) IPv6Address() string {
	if t.IPv6Host != nil {
		return *t.IPv6Host
	}
	if t.Host == t.ID+"-v4.ip.zstaticcdn.com" {
		return t.ID + "-v6.ip.zstaticcdn.com"
	}
	// Preserve older custom catalogs that stored a literal IPv6 in the only host field.
	if ip := net.ParseIP(t.Host); ip != nil && ip.To4() == nil {
		return t.Host
	}
	return ""
}
func (s Settings) Probes(selected ...[]string) []connectivity.Target {
	families := []string{"IPv4"}
	if len(selected) > 0 {
		families = selected[0]
	}
	out := make([]connectivity.Target, 0, len(s.Targets)*len(families))
	for _, t := range s.Targets {
		if !t.Enabled {
			continue
		}
		for _, family := range families {
			host, id := t.Host, t.ID
			if family == "IPv6" {
				host, id = t.IPv6Address(), t.ID+"@IPv6"
			} else if family != "IPv4" {
				continue
			} else if ip := net.ParseIP(host); ip != nil && ip.To4() == nil {
				continue
			}
			if host == "" {
				continue
			}
			a := net.JoinHostPort(host, strconv.Itoa(t.Port))
			out = append(out, connectivity.Target{ID: id, Name: t.Province, Group: t.Region, Icon: t.Carrier, Host: a, URL: a, Family: family})
		}
	}
	return out
}

type Record struct {
	ID          uint64 `gorm:"primaryKey"`
	ServerUUID  string `gorm:"index"`
	Identity    string `gorm:"index:idx_latency_identity_time,priority:1;uniqueIndex:idx_latency_batch,priority:1"`
	FinishedAt  int64  `gorm:"index;index:idx_latency_identity_time,priority:2;uniqueIndex:idx_latency_batch,priority:2"`
	ScheduledAt int64
	Payload     string
}

func (Record) TableName() string { return "latency_records" }

type payload struct {
	Snapshot connectivity.Snapshot
	URLs     map[string]string
}

func Save(db *gorm.DB, key string, s connectivity.Snapshot) error {
	if s.State != "complete" || s.FinishedAt == 0 {
		return errors.New("incomplete latency result")
	}
	// Manual runs are transient current results, never retained history.
	if s.ScheduledAt <= 0 {
		return nil
	}
	urls := map[string]string{}
	for _, r := range s.Results {
		urls[r.ID] = r.URL
	}
	raw, e := json.Marshal(payload{s, urls})
	if e != nil {
		return e
	}
	parts := strings.Split(key, ":")
	if len(parts) < 2 {
		return errors.New("invalid identity")
	}
	row := Record{ServerUUID: parts[1], Identity: key, FinishedAt: s.FinishedAt, ScheduledAt: s.ScheduledAt, Payload: string(raw)}
	return db.Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error
}
func Decode(row Record) (connectivity.Snapshot, error) {
	var p payload
	e := json.Unmarshal([]byte(row.Payload), &p)
	p.Snapshot.Full = true
	for i := range p.Snapshot.Results {
		p.Snapshot.Results[i].URL = p.URLs[p.Snapshot.Results[i].ID]
	}
	return p.Snapshot, e
}
func Latest(db *gorm.DB, key string, days int) (connectivity.Snapshot, bool, error) {
	var row Record
	r := db.Where("identity = ? AND scheduled_at > 0 AND finished_at >= ?", key, time.Now().Add(-time.Duration(days)*24*time.Hour).UnixMilli()).Order("finished_at DESC").Limit(1).Find(&row)
	if r.Error != nil || r.RowsAffected == 0 {
		return connectivity.Snapshot{}, false, r.Error
	}
	s, e := Decode(row)
	return s, e == nil, e
}
