package model

import (
	"encoding/json"
	"fmt"
	"math"
	"slices"
	"strings"
	"time"
)

// One administrator-owned global policy; reminders are opt-in on fresh installs.
type ServerExpiryConfig struct {
	ID                  uint64 `gorm:"primaryKey" json:"-"`
	Enabled             bool   `json:"enabled"`
	NotificationGroupID uint64 `json:"notification_group_id"`
	Days                []int  `gorm:"serializer:json" json:"days"`
}

// UUID survives display-ID reassignment. Each recipient is retried independently.
type ServerExpiryDelivery struct {
	UUID           string `gorm:"primaryKey;size:64" json:"-"`
	ExpiresAt      int64  `gorm:"primaryKey" json:"expires_at"`
	Days           int    `gorm:"primaryKey" json:"days"`
	NotificationID uint64 `gorm:"primaryKey" json:"notification_id"`
	SentAt         int64  `json:"sent_at"`
	RetryAt        int64  `json:"retry_at"`
	Attempts       int    `json:"attempts"`
	LastError      string `json:"last_error"`
}

func DefaultServerExpiryConfig() ServerExpiryConfig {
	return ServerExpiryConfig{ID: 1, Days: []int{7, 3, 1, 0}}
}
func (c *ServerExpiryConfig) Validate() error {
	if len(c.Days) == 0 || len(c.Days) > 20 {
		return fmt.Errorf("请设置 1–20 个提醒时间")
	}
	seen := map[int]bool{}
	for _, d := range c.Days {
		if d < 0 || d > 365 || seen[d] {
			return fmt.Errorf("提醒天数必须为不重复的 0–365 整数")
		}
		seen[d] = true
	}
	slices.SortFunc(c.Days, func(a, b int) int { return b - a })
	if c.Enabled && c.NotificationGroupID == 0 {
		return fmt.Errorf("启用前请选择有效通知组")
	}
	return nil
}

type ServerBilling struct {
	LatestEndDate     string `json:"latest_end_date"`
	RenewalProjected  bool   `json:"renewal_projected"`
	RenewalWarning    string `json:"renewal_warning"`
	PreviousExpiresAt int64  `json:"-"`
	StartDate         string `json:"start_date"`
	EndDate           string `json:"end_date"`
	Cycle             string `json:"cycle"`
	Amount            string `json:"amount"`
	AutoRenewal       bool   `json:"auto_renewal"`
	Status            string `json:"status"`
	ExpiresAt         int64  `json:"expires_at"`
	RemainingDays     int    `json:"remaining_days"`
}

func ParseBillingDate(raw string) (time.Time, error) {
	raw = strings.Replace(strings.TrimSpace(raw), " ", "T", 1)
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02T15:04:05", "2006-01-02T15:04", "2006-01-02"} {
		if t, e := time.ParseInLocation(layout, raw, PlanTrafficZone); e == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("日期格式无效")
}
func BillingCycleLabel(c string) string {
	switch strings.ToLower(strings.TrimSpace(c)) {
	case "d", "day", "daily", "日", "天", "日付":
		return "日"
	case "w", "week", "weekly", "周", "周付":
		return "周"
	case "m", "mo", "month", "monthly", "月", "月付":
		return "月"
	case "q", "qr", "quarter", "quarterly", "季", "季度", "季付":
		return "季"
	case "h", "half", "半", "halfyear", "half-year", "semiannually", "semi-annually", "半年", "半年付":
		return "半年"
	case "y", "yr", "annual", "year", "yearly", "annually", "年", "年付":
		return "年"
	case "biennially", "2year", "两年", "二年":
		return "两年"
	case "triennially", "3year", "三年":
		return "三年"
	case "onetime", "one-time", "一次性":
		return "一次性"
	default:
		return c // Preserve custom periods; expiry never depends on an allowlist.
	}
}
func ParseServerBilling(raw string, now time.Time) ServerBilling {
	b := ServerBilling{Status: "未设置到期时间"}
	var root, billing map[string]json.RawMessage
	if json.Unmarshal([]byte(raw), &root) != nil {
		return b
	}
	group := root["billingDataMod"]
	if len(group) == 0 {
		group = root["账单信息"]
	}
	if json.Unmarshal(group, &billing) != nil {
		return b
	}
	b.StartDate = noteString(billing, "startDate", "开始时间")
	b.EndDate = noteString(billing, "endDate", "到期时间")
	b.Cycle = BillingCycleLabel(noteString(billing, "cycle", "付费周期"))
	b.Amount = noteString(billing, "amount", "价格")
	renew := noteString(billing, "autoRenewal", "自动续费")
	b.AutoRenewal = renew == "1" || renew == "开启" || string(billing["自动续费"]) == "true" || string(billing["autoRenewal"]) == "true"
	if b.EndDate == "" {
		return b
	}
	if strings.HasPrefix(b.EndDate, "0000-00-00") || b.EndDate == "永不过期" || b.EndDate == "不过期" {
		b.Status = "永不过期"
		return b
	}
	end, err := ParseBillingDate(b.EndDate)
	if err != nil {
		b.Status = "到期日期无效"
		return b
	}
	if b.AutoRenewal {
		var supported bool
		end, b.PreviousExpiresAt, supported = latestBillingExpiry(end.In(PlanTrafficZone), now, b.Cycle)
		if !supported {
			b.RenewalWarning = "付款周期无法推算，按原始到期日期提醒"
		}
		original, _ := ParseBillingDate(b.EndDate)
		b.RenewalProjected = !end.Equal(original)
	}
	b.LatestEndDate = end.In(PlanTrafficZone).Format(time.RFC3339)
	b.ExpiresAt = end.Unix()
	b.RemainingDays = int(math.Ceil(end.Sub(now).Hours() / 24))
	b.Status = "未到期"
	if !now.Before(end) {
		b.Status = "已到期"
	}
	return b
}

// Match card renewal semantics: repeatedly advance from the saved expiry,
// clamping month-end dates like dayjs.add(month, "month"), never Go's overflow.
// Original purchase/end values are retained; this is an estimate, not payment proof.
func latestBillingExpiry(end, now time.Time, cycle string) (time.Time, int64, bool) {
	months, days := 0, 0
	switch cycle {
	case "日":
		days = 1
	case "周":
		days = 7
	case "月":
		months = 1
	case "季":
		months = 3
	case "半年":
		months = 6
	case "年":
		months = 12
	case "两年":
		months = 24
	case "三年":
		months = 36
	default:
		return end, 0, false
	}
	var previous int64
	for !end.After(now) {
		previous = end.Unix()
		if days > 0 {
			end = end.AddDate(0, 0, days)
		} else {
			first := time.Date(end.Year(), end.Month()+time.Month(months), 1, end.Hour(), end.Minute(), end.Second(), end.Nanosecond(), end.Location())
			lastDay := first.AddDate(0, 1, -1).Day()
			end = first.AddDate(0, 0, min(end.Day(), lastDay)-1)
		}
	}
	return end, previous, true
}

// ExpiryCandidates preserves the just-ended cycle's day-zero reminder even
// though the displayed date has advanced. Each cycle has its own durable key.
func (b ServerBilling) ExpiryCandidates(now time.Time, days []int) []ServerBilling {
	result := []ServerBilling{b}
	if b.PreviousExpiresAt > 0 {
		previous := time.Unix(b.PreviousExpiresAt, 0)
		if stage, due := ServerExpiryStage(previous, now, days); due && stage == 0 {
			ended := b
			ended.ExpiresAt = b.PreviousExpiresAt
			ended.RemainingDays = int(math.Ceil(previous.Sub(now).Hours() / 24))
			ended.Status = "已到期"
			result = append(result, ended)
		}
	}
	return result
}

// Pick only the nearest reached threshold, never replay several older stages.
// Zero means the actual expiry time; a missed expiry is caught up for 24 hours.
func ServerExpiryStage(end, now time.Time, days []int) (int, bool) {
	remaining := end.Sub(now)
	if remaining <= 0 {
		return 0, remaining > -24*time.Hour && slices.Contains(days, 0)
	}
	chosen := 366
	for _, d := range days {
		if d > 0 && remaining <= time.Duration(d)*24*time.Hour && d < chosen {
			chosen = d
		}
	}
	return chosen, chosen <= 365
}
