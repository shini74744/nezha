package model

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var PlanTrafficZone = time.FixedZone("Asia/Shanghai", 8*60*60)

// UUID, not display ID, owns the durable accounting history.
type PlanTrafficCheckpoint struct {
	UUID        string `gorm:"primaryKey;size:64"`
	At          int64
	In          uint64
	Out         uint64
	Uptime      uint64
	CoveredFrom int64
}
type PlanTrafficDay struct {
	UUID      string `gorm:"primaryKey;size:64"`
	Day       string `gorm:"primaryKey;size:10"`
	In        uint64
	Out       uint64
	Estimated bool
}
type TrafficPlan struct {
	QuotaType string
	Max       uint64
	ResetDay  int
	Direction string
}
type PlanTrafficStat struct {
	QuotaType    string    `json:"quota_type"`
	Name         string    `json:"name"`
	From         time.Time `json:"from"`
	To           time.Time `json:"to"`
	Max          uint64    `json:"max"`
	Used         uint64    `json:"used"`
	In           uint64    `json:"in"`
	Out          uint64    `json:"out"`
	Direction    string    `json:"direction"`
	ResetDay     int       `json:"reset_day"`
	Partial      bool      `json:"partial"`
	Estimated    bool      `json:"estimated"`
	RecordedFrom int64     `json:"recorded_from"`
	LastReportAt int64     `json:"last_report_at"`
	Error        string    `json:"error,omitempty"`
}

var quotaPattern = regexp.MustCompile(`(?i)^([0-9]+(?:\.[0-9]+)?)\s*(B|[KMGTPE](?:I?B)?)\s*(?:/\s*(?:月|MONTH|MO)|每月)?$`)

func noteString(m map[string]json.RawMessage, english, chinese string) string {
	v, ok := m[english]
	if !ok {
		v = m[chinese]
	}
	var s string
	if json.Unmarshal(v, &s) == nil {
		return strings.TrimSpace(s)
	}
	var n json.Number
	if json.Unmarshal(v, &n) == nil {
		return n.String()
	}
	return ""
}
func ParseTrafficPlan(raw string) (*TrafficPlan, error) {
	var root map[string]json.RawMessage
	if json.Unmarshal([]byte(raw), &root) != nil {
		root = nil // Empty/legacy plain-text notes still receive monthly accounting.
	}
	group := root["planDataMod"]
	if len(group) == 0 {
		group = root["套餐信息"]
	}
	var p map[string]json.RawMessage
	if json.Unmarshal(group, &p) != nil {
		p = nil
	}
	volume := noteString(p, "trafficVol", "流量")
	quotaType, amount := "unset", float64(0)
	if strings.Contains(volume, "无限") || strings.Contains(volume, "不限") || strings.EqualFold(volume, "unlimited") || strings.EqualFold(volume, "unmetered") || volume == "∞" {
		quotaType = "unlimited"
	} else if volume != "" {
		quotaType = "limited"
		volume = strings.TrimPrefix(strings.TrimPrefix(volume, "单向"), "双向")
		match := quotaPattern.FindStringSubmatch(volume)
		if match == nil {
			return nil, fmt.Errorf("流量配额格式无效，请填写如 5TB/月")
		}
		n, _ := strconv.ParseFloat(match[1], 64)
		unit := strings.ToUpper(match[2])
		power := 0
		if unit != "B" {
			power = strings.Index("KMGTPE", unit[:1]) + 1
		}
		amount = n * math.Pow(1024, float64(power))
		if math.IsInf(amount, 0) || amount < 1 || amount > float64(1<<53) {
			return nil, fmt.Errorf("流量配额超出支持范围")
		}
	}
	direction := noteString(p, "trafficType", "流量统计方向")
	switch direction {
	case "", "0", "未指定":
		direction = "2"
	case "下载", "入站":
		direction = "1"
	case "双向":
		direction = "2"
	case "上传", "出站":
		direction = "3"
	}
	if direction != "1" && direction != "2" && direction != "3" {
		return nil, fmt.Errorf("请在套餐配置中选择流量类型：上传、下载或双向")
	}
	day := 1
	reset := noteString(p, "resetDay", "流量重置日")
	if reset != "" {
		var err error
		day, err = strconv.Atoi(reset)
		if err != nil || day < 1 || day > 31 {
			return nil, fmt.Errorf("流量重置日必须为 1–31")
		}
	} else {
		braw := root["billingDataMod"]
		if len(braw) == 0 {
			braw = root["账单信息"]
		}
		var b map[string]json.RawMessage
		if json.Unmarshal(braw, &b) == nil {
			startValue := noteString(b, "startDate", "开始时间")
			start, err := time.Parse(time.RFC3339, startValue)
			if err != nil {
				start, err = time.ParseInLocation("2006-01-02", startValue, PlanTrafficZone)
			}
			if err == nil {
				day = start.In(PlanTrafficZone).Day()
			}
		}
	}
	return &TrafficPlan{QuotaType: quotaType, Max: uint64(amount), ResetDay: day, Direction: direction}, nil
}

// Calendar anchoring never uses AddDate on the 29th/30th/31st (which can skip months).
func PlanTrafficCycle(now time.Time, day int) (time.Time, time.Time) {
	now = now.In(PlanTrafficZone)
	if day < 1 || day > 31 {
		day = 1
	}
	boundary := func(year int, month time.Month) time.Time {
		first := time.Date(year, month, 1, 0, 0, 0, 0, PlanTrafficZone)
		last := first.AddDate(0, 1, -1).Day()
		return time.Date(first.Year(), first.Month(), min(day, last), 0, 0, 0, 0, PlanTrafficZone)
	}
	start := boundary(now.Year(), now.Month())
	if now.Before(start) {
		start = boundary(now.Year(), now.Month()-1)
	}
	return start, boundary(start.Year(), start.Month()+1)
}
