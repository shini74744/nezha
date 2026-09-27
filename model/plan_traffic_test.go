package model

import (
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func TestTrafficPlanCompatibility(t *testing.T) {
	for _, tc := range []struct {
		raw string
		max uint64
		day int
		dir string
	}{
		{`{"billingDataMod":{"startDate":"2026-06-15T00:00:00+08:00"},"planDataMod":{"trafficVol":"5TB/月","trafficType":"0"}}`, 5 << 40, 15, "2"},
		{`{"套餐信息":{"流量":"500G/月","流量重置日":31,"流量统计方向":"出站"}}`, 500 << 30, 31, "3"},
		{`{"planDataMod":{"trafficVol":"1.5TiB/Month","resetDay":"2","trafficType":"1"}}`, 3 << 39, 2, "1"},
		{`{"planDataMod":{"trafficVol":"单向1TB/月","trafficType":"3"}}`, 1 << 40, 1, "3"},
		{`{"planDataMod":{"trafficVol":"10T/月"}}`, 10 << 40, 1, "2"},
	} {
		p, err := ParseTrafficPlan(tc.raw)
		require.NoError(t, err)
		require.Equal(t, &TrafficPlan{QuotaType: "limited", Max: tc.max, ResetDay: tc.day, Direction: tc.dir}, p)
	}
	for _, tc := range []struct {
		raw, kind string
		day       int
	}{
		{`{"billingDataMod":{"startDate":"2026-05-02"},"planDataMod":{"trafficVol":""}}`, "unset", 2},
		{`{"账单信息":{"开始时间":"2026-05-02"},"套餐信息":{"流量":"无限","流量重置日":15}}`, "unlimited", 15},
		{`{"planDataMod":{"trafficVol":"unlimited","resetDay":31}}`, "unlimited", 31},
		{`{"planDataMod":{"trafficVol":"不限量"}}`, "unlimited", 1},
	} {
		plan, err := ParseTrafficPlan(tc.raw)
		require.NoError(t, err)
		require.Equal(t, tc.kind, plan.QuotaType)
		require.Equal(t, tc.day, plan.ResetDay)
	}
	for _, raw := range []string{`{}`, `{"planDataMod":{"trafficVol":"无限TB/月"}}`, "旧备注"} {
		p, err := ParseTrafficPlan(raw)
		require.NoError(t, err)
		require.NotNil(t, p)
		require.Zero(t, p.Max)
		require.Contains(t, []string{"unset", "unlimited"}, p.QuotaType)
	}
	for _, v := range []string{"500/月", "1TB/年", "0TB", "NaNTB", "999999999999PB"} {
		_, err := ParseTrafficPlan(`{"planDataMod":{"trafficVol":"` + v + `"}}`)
		require.Error(t, err)
	}
	for _, v := range []string{"0", "32", "1.5"} {
		_, err := ParseTrafficPlan(`{"planDataMod":{"trafficVol":"1TB","resetDay":"` + v + `"}}`)
		require.Error(t, err)
	}
}
func TestTrafficCycleUsesResetDayThenPurchaseDay(t *testing.T) {
	for _, tc := range []struct {
		reset, now, from, to string
		day                  int
	}{
		{"", "2026-09-01T23:59:59+08:00", "2026-08-02", "2026-09-02", 2},
		{"", "2026-09-02T00:00:00+08:00", "2026-09-02", "2026-10-02", 2},
		{"15", "2026-09-14T23:59:59+08:00", "2026-08-15", "2026-09-15", 15},
		{"15", "2026-09-15T00:00:00+08:00", "2026-09-15", "2026-10-15", 15},
	} {
		plan, err := ParseTrafficPlan(`{"billingDataMod":{"startDate":"2026-05-02T12:30:00+08:00"},"planDataMod":{"trafficVol":"5TB/月","resetDay":"` + tc.reset + `"}}`)
		require.NoError(t, err)
		require.Equal(t, tc.day, plan.ResetDay)
		now, err := time.Parse(time.RFC3339, tc.now)
		require.NoError(t, err)
		from, to := PlanTrafficCycle(now, plan.ResetDay)
		require.Equal(t, tc.from+"T00:00:00+08:00", from.Format(time.RFC3339))
		require.Equal(t, tc.to+"T00:00:00+08:00", to.Format(time.RFC3339))
	}
}
func TestPlanTrafficCycleCalendar(t *testing.T) {
	for _, tc := range []struct {
		now        string
		day        int
		start, end string
	}{
		{"2026-09-14T15:59:59Z", 15, "2026-08-15", "2026-09-15"},
		{"2026-09-14T16:00:00Z", 15, "2026-09-15", "2026-10-15"},
		{"2026-02-28T00:00:00+08:00", 31, "2026-02-28", "2026-03-31"},
		{"2028-02-29T00:00:00+08:00", 31, "2028-02-29", "2028-03-31"},
		{"2026-03-30T23:59:59+08:00", 31, "2026-02-28", "2026-03-31"},
		{"2026-12-31T16:00:00Z", 1, "2027-01-01", "2027-02-01"},
	} {
		now, err := time.Parse(time.RFC3339, tc.now)
		require.NoError(t, err)
		a, b := PlanTrafficCycle(now, tc.day)
		require.Equal(t, tc.start, a.Format("2006-01-02"))
		require.Equal(t, tc.end, b.Format("2006-01-02"))
		require.Equal(t, 0, a.Hour())
		_, offset := a.Zone()
		require.Equal(t, 8*3600, offset)
	}
}
