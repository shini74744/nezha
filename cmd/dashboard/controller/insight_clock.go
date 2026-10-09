package controller

import (
	"github.com/nezhahq/nezha/service/connectivity"
	"time"
)

// Return-route intervals restart at Beijing midnight, including non-divisors of
// 24 (e.g. five hours: 00, 05, 10, 15, 20, then next day 00).
// Other detection features retain their existing schedule.
func insightClockSlot(kind string, now time.Time, hours int) time.Time {
	if kind != "return-route" {
		return connectivity.ClockSlot(now, hours)
	}
	if hours < 1 {
		hours = 1
	}
	if hours > 24 {
		hours = 24
	}
	local := now.In(time.FixedZone("Asia/Shanghai", 8*60*60))
	midnight := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, local.Location())
	return midnight.Add(time.Duration(local.Hour()/hours*hours) * time.Hour)
}
