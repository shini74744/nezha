package model

import (
	"fmt"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func TestServerExpiryParsing(t *testing.T) {
	now, _ := time.Parse(time.RFC3339, "2026-10-01T12:00:00+08:00")
	for _, raw := range []string{"", "plain note", "{}", `{"billingDataMod":{"startDate":"2026-09-01","cycle":"Month"}}`, `{"billingDataMod":{"endDate":"0000-00-00T23:59:59+08:00"}}`, `{"billingDataMod":{"endDate":"2026-02-30"}}`} {
		require.Zero(t, ParseServerBilling(raw, now).ExpiresAt, raw)
	}
	for _, cycle := range []string{"Day", "Week", "Month", "Quarter", "HalfYear", "Year", "两年", "三年", "每18个月"} {
		b := ParseServerBilling(`{"billingDataMod":{"startDate":"2026-09-01","endDate":"2026-10-02T12:00:00+08:00","cycle":"`+cycle+`","autoRenewal":"1"}}`, now)
		require.Equal(t, now.Add(24*time.Hour).Unix(), b.ExpiresAt)
		require.Equal(t, 1, b.RemainingDays)
		require.True(t, b.AutoRenewal)
	}
	b := ParseServerBilling(`{"账单信息":{"开始时间":"2026-09-02","到期时间":"2026-10-02 12:00:00","付费周期":"年","自动续费":true,"价格":99}}`, now)
	require.Equal(t, now.Add(24*time.Hour).Unix(), b.ExpiresAt)
	require.Equal(t, "年", b.Cycle)
	require.Equal(t, "99", b.Amount)
	require.True(t, b.AutoRenewal)
	after := ParseServerBilling(`{"billingDataMod":{"endDate":"2026-09-01","autoRenewal":"1","cycle":"Month"}}`, now)
	require.Equal(t, "未到期", after.Status)
	require.Equal(t, "2026-11-01T00:00:00+08:00", after.LatestEndDate)
	require.Equal(t, "2026-09-01", after.EndDate)
	a, _ := ParseBillingDate("2026-10-02T04:00:00Z")
	c, _ := ParseBillingDate("2026-10-02 12:00:00")
	require.Equal(t, a.Unix(), c.Unix())
}
func TestServerExpiryThresholdsAndValidation(t *testing.T) {
	now := time.Now()
	for _, tc := range []struct {
		hours float64
		stage int
		due   bool
	}{
		{169, 366, false}, {168, 7, true}, {100, 7, true}, {72, 3, true}, {24, 1, true}, {0.01, 1, true}, {0, 0, true}, {-23, 0, true}, {-24, 0, false}} {
		stage, ok := ServerExpiryStage(now.Add(time.Duration(tc.hours*float64(time.Hour))), now, []int{7, 3, 1, 0})
		require.Equal(t, tc.due, ok)
		if ok {
			require.Equal(t, tc.stage, stage)
		}
	}
	for _, days := range [][]int{nil, {}, {-1}, {366}, {1, 1}} {
		c := ServerExpiryConfig{Days: days}
		require.Error(t, c.Validate())
	}
	c := DefaultServerExpiryConfig()
	c.Enabled = true
	require.Error(t, c.Validate())
	c.NotificationGroupID = 1
	require.NoError(t, c.Validate())
	_, due := ServerExpiryStage(now, now, []int{7, 1})
	require.False(t, due)
}

func TestServerExpiryFollowsCardRenewal(t *testing.T) {
	tests := []struct{ end, cycle, now, want string }{
		{"2025-06-28T23:15:33+08:00", "Month", "2026-10-02T15:00:00+08:00", "2026-10-28T23:15:33+08:00"},
		{"2025-06-06T22:36:49+08:00", "月", "2026-10-02T15:00:00+08:00", "2026-10-06T22:36:49+08:00"},
		{"2026-01-31T12:34:56+08:00", "Month", "2026-03-01T00:00:00+08:00", "2026-03-28T12:34:56+08:00"},
		{"2024-02-29T12:34:56+08:00", "Year", "2026-03-01T00:00:00+08:00", "2027-02-28T12:34:56+08:00"},
		{"2026-10-01T01:02:03+08:00", "Day", "2026-10-02T01:02:03+08:00", "2026-10-03T01:02:03+08:00"},
		{"2026-09-01T00:00:00+08:00", "Week", "2026-10-02T00:00:00+08:00", "2026-10-06T00:00:00+08:00"},
		{"2025-12-31T00:00:00+08:00", "Quarter", "2026-10-02T00:00:00+08:00", "2026-12-30T00:00:00+08:00"},
		{"2025-06-30T00:00:00+08:00", "HalfYear", "2026-10-02T00:00:00+08:00", "2026-12-30T00:00:00+08:00"},
		{"2024-12-01T00:00:00+08:00", "两年", "2026-10-02T00:00:00+08:00", "2026-12-01T00:00:00+08:00"},
		{"2023-12-01T00:00:00+08:00", "三年", "2026-10-02T00:00:00+08:00", "2026-12-01T00:00:00+08:00"},
		{"2025-06-28T15:15:33Z", "mo", "2026-10-02T15:00:00+08:00", "2026-10-28T23:15:33+08:00"},
	}
	for _, tc := range tests {
		for _, flag := range []string{"0", "1", ""} {
			now, _ := ParseBillingDate(tc.now)
			raw := fmt.Sprintf("{\"billingDataMod\":{\"startDate\":\"2020-01-01\",\"endDate\":%q,\"cycle\":%q,\"autoRenewal\":%q}}", tc.end, tc.cycle, flag)
			b := ParseServerBilling(raw, now)
			if flag == "1" {
				require.Equal(t, tc.want, b.LatestEndDate, tc.cycle)
				require.Equal(t, "未到期", b.Status)
			} else {
				original, _ := ParseBillingDate(tc.end)
				require.Equal(t, original.Unix(), b.ExpiresAt)
				require.Equal(t, "已到期", b.Status)
			}
			require.Equal(t, tc.end, b.EndDate)
			require.Equal(t, "2020-01-01", b.StartDate)
			require.Empty(t, b.RenewalWarning)
		}
	}
	now, _ := ParseBillingDate("2026-10-02T12:00:00+08:00")
	custom := ParseServerBilling(`{"billingDataMod":{"endDate":"2025-01-01","cycle":"自定义","autoRenewal":"1"}}`, now)
	require.Equal(t, "已到期", custom.Status)
	require.NotEmpty(t, custom.RenewalWarning)
	for _, raw := range []string{
		`{"billingDataMod":{"startDate":"2020-01-01","cycle":"Month"}}`,
		`{"billingDataMod":{"endDate":"0000-00-00T23:59:59+08:00","cycle":"Month"}}`,
	} {
		require.Zero(t, ParseServerBilling(raw, now).ExpiresAt)
	}
}
func TestServerExpiryRenewalBoundary(t *testing.T) {
	now, _ := ParseBillingDate("2026-10-02T12:00:00+08:00")
	raw := `{"billingDataMod":{"endDate":"2025-10-02T12:00:00+08:00","cycle":"Month","autoRenewal":"1"}}`
	for _, delta := range []time.Duration{0, time.Minute, 23 * time.Hour} {
		at := now.Add(delta)
		b := ParseServerBilling(raw, at)
		candidates := b.ExpiryCandidates(at, []int{7, 3, 1, 0})
		require.Len(t, candidates, 2)
		require.Equal(t, now.Unix(), candidates[1].ExpiresAt)
		stage, due := ServerExpiryStage(time.Unix(candidates[1].ExpiresAt, 0), at, []int{7, 3, 1, 0})
		require.True(t, due)
		require.Zero(t, stage)
		require.Equal(t, "2026-11-02T12:00:00+08:00", b.LatestEndDate)
	}
	at := now.Add(24 * time.Hour)
	require.Len(t, ParseServerBilling(raw, at).ExpiryCandidates(at, []int{7, 3, 1, 0}), 1)
	require.Len(t, ParseServerBilling(raw, now).ExpiryCandidates(now, []int{7, 3, 1}), 1)
}
