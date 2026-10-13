package model

import (
	"errors"
	"strconv"
	"time"
)

// AccessPasswordSchedule uses Beijing civil time, independently of the host timezone.
// A disabled schedule preserves the existing all-day password requirement.
type AccessPasswordSchedule struct {
	Enabled bool   `json:"enabled" koanf:"enabled"`
	Start   string `json:"start" koanf:"start"`
	End     string `json:"end" koanf:"end"`
}

var accessPasswordZone = time.FixedZone("Asia/Shanghai", 8*60*60)

func (s AccessPasswordSchedule) WithDefaults() AccessPasswordSchedule {
	if !s.Enabled && s.Start == "" && s.End == "" {
		s.Start, s.End = "08:00", "23:00"
	}
	return s
}
func accessMinute(value string) (int, bool) {
	if len(value) != 5 || value[2] != ':' {
		return 0, false
	}
	for _, i := range []int{0, 1, 3, 4} {
		if value[i] < '0' || value[i] > '9' {
			return 0, false
		}
	}
	hour, _ := strconv.Atoi(value[:2])
	minute, _ := strconv.Atoi(value[3:])
	return hour*60 + minute, hour < 24 && minute < 60
}
func (s AccessPasswordSchedule) Validate() error {
	s = s.WithDefaults()
	start, a := accessMinute(s.Start)
	end, b := accessMinute(s.End)
	if !a || !b || start == end {
		return errors.New("请选择不同的开始、结束时间（00:00–23:59）；全天验证请关闭定时选项")
	}
	return nil
}
func (s AccessPasswordSchedule) ActiveAt(now time.Time) bool {
	if !s.Enabled {
		return true
	}
	start, a := accessMinute(s.Start)
	end, b := accessMinute(s.End)
	// Fail closed if a manually edited configuration is malformed.
	if !a || !b || start == end {
		return true
	}
	local := now.In(accessPasswordZone)
	minute := local.Hour()*60 + local.Minute()
	if start < end {
		return minute >= start && minute < end
	}
	return minute >= start || minute < end
}
