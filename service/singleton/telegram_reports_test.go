package singleton

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
	"unicode/utf16"

	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
)

func telegramTrafficFixture(t *testing.T) (*model.Notification, time.Time) {
	n := telegramSetup(t)
	now := trafficTime("2026-10-11T00:00:01+08:00")
	ServerShared.InsertForTest(&model.Server{Common: model.Common{ID: 11, UserID: 10}, Name: "own", UUID: "own-uuid"})
	ServerShared.InsertForTest(&model.Server{Common: model.Common{ID: 12, UserID: 999}, Name: "foreign-secret", UUID: "foreign-uuid"})
	for _, d := range []model.PlanTrafficDay{
		{UUID: "own-uuid", Day: "2026-10-10", In: 1024, Out: 2048, Estimated: true},
		{UUID: "own-uuid", Day: "2026-10-11", In: 512, Out: 256},
		{UUID: "foreign-uuid", Day: "2026-10-10", In: 999999, Out: 888888},
	} {
		require.NoError(t, DB.Create(&d).Error)
	}
	require.NoError(t, DB.Create(&model.PlanTrafficCheckpoint{UUID: "own-uuid", At: now.UnixMilli(), CoveredFrom: now.Add(-48 * time.Hour).UnixMilli()}).Error)
	n.TelegramMenu.LoginSuccess = true
	n.TelegramMenu.LoginFailure = true
	n.TelegramMenu.DailyTraffic = true
	require.NoError(t, DB.Save(n).Error)
	return n, now
}
func TestTelegramTrafficDayTimezonePrivacyAndMissing(t *testing.T) {
	_, now := telegramTrafficFixture(t)
	rows, err := telegramServerRows(10, now)
	require.NoError(t, err)
	sum, err := telegramTrafficQuery(context.Background(), rows, now, now)
	require.NoError(t, err)
	require.Equal(t, "2026-10-11", sum.Day)
	require.Equal(t, float64(512), sum.In)
	require.Equal(t, float64(256), sum.Out)
	view, err := telegramTrafficView(context.Background(), rows, "yesterday", 0, now)
	require.NoError(t, err)
	require.Contains(t, view.Text, "2.00 KiB")
	require.Contains(t, view.Text, "1.00 KiB")
	require.Contains(t, view.Text, "3.00 KiB")
	require.NotContains(t, view.Text, "foreign-secret")
	view, err = telegramTrafficView(context.Background(), rows, "day2026-10-10", 0, now.AddDate(0, 0, 4))
	require.NoError(t, err)
	require.Contains(t, view.Text, "2026-10-10")
	require.Contains(t, view.Text, "3.00 KiB")
	rows = append(rows, telegramServerRow{ID: 99, Name: "no data", UUID: "missing"})
	sum, err = telegramTrafficQuery(context.Background(), rows, now, now)
	require.NoError(t, err)
	require.Equal(t, 1, sum.Partial)
	for i := 0; i < 119; i++ {
		rows = append(rows, telegramServerRow{ID: uint64(i + 100), Name: telegramSafeName(strings.Repeat("😀", 80))})
	}
	view, err = telegramTrafficView(context.Background(), rows, "traffic", 0, now)
	require.NoError(t, err)
	require.Less(t, len(utf16.Encode([]rune(view.Text))), 4096)
	_, page, ok := telegramParseCallback("nzsm:day2026-10-10:2")
	require.True(t, ok)
	require.Equal(t, 2, page)
	_, _, ok = telegramParseCallback("nzsm:day2026-02-30:0")
	require.False(t, ok)
}
func TestTelegramDailyMidnightRestartAndNoDuplicate(t *testing.T) {
	n, now := telegramTrafficFixture(t)
	target, err := n.TelegramMenuTarget()
	require.NoError(t, err)
	sends := 0
	api := newTelegramAPI(target)
	api.client.Transport = telegramRoundTrip(func(r *http.Request) (*http.Response, error) {
		sends++
		var body map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		require.Contains(t, body["text"], "2026-10-10")
		require.NotContains(t, body["text"], "foreign-secret")
		require.Contains(t, body["text"], "3.00 KiB")
		return telegramTestResponse(map[string]int{"message_id": 1}), nil
	})
	require.NoError(t, telegramSendDaily(context.Background(), n, now.Add(-2*time.Second), api))
	require.Zero(t, sends, "no old report on first activation")
	require.NoError(t, telegramSendDaily(context.Background(), n, now, api))
	require.Equal(t, 1, sends)
	for i := 0; i < 3; i++ {
		require.NoError(t, telegramSendDaily(context.Background(), n, now.Add(time.Minute), api))
	}
	require.Equal(t, 1, sends, "durable cursor survives restart and repeated ticks")
	var cursor model.TelegramDailyDelivery
	require.NoError(t, DB.First(&cursor, n.ID).Error)
	require.Equal(t, "sent", cursor.State)
	require.Equal(t, "2026-10-10", cursor.LastDay)
}
func TestTelegramDailyExplicitRetryAmbiguousAndDisable(t *testing.T) {
	for _, mode := range []string{"rate-limit", "ambiguous", "claimed", "disabled"} {
		t.Run(mode, func(t *testing.T) {
			n, now := telegramTrafficFixture(t)
			require.NoError(t, DB.Create(&model.TelegramDailyDelivery{NotificationID: n.ID, LastDay: "2026-10-09"}).Error)
			target, _ := n.TelegramMenuTarget()
			api := newTelegramAPI(target)
			sends := 0
			api.client.Transport = telegramRoundTrip(func(r *http.Request) (*http.Response, error) {
				sends++
				if mode == "ambiguous" {
					return nil, errors.New("secret URL must not leak")
				}
				if mode == "rate-limit" && sends == 1 {
					return &http.Response{StatusCode: 429, Body: io.NopCloser(strings.NewReader(`{"ok":false,"error_code":429,"parameters":{"retry_after":60}}`))}, nil
				}
				return telegramTestResponse(map[string]int{"message_id": 1}), nil
			})
			if mode == "claimed" {
				require.NoError(t, DB.Model(&model.TelegramDailyDelivery{}).Where("notification_id = ?", n.ID).Updates(map[string]any{"claim_day": "2026-10-10", "state": "sending"}).Error)
			}
			if mode == "disabled" {
				fresh := *n
				cfg := *n.TelegramMenu
				cfg.Enabled = false
				fresh.TelegramMenu = &cfg
				require.NoError(t, DB.Save(&fresh).Error)
			}
			_ = telegramSendDaily(context.Background(), n, now, api)
			_ = telegramSendDaily(context.Background(), n, now.Add(2*time.Minute), api)
			want := 0
			if mode == "ambiguous" {
				want = 1
			}
			if mode == "rate-limit" {
				want = 2
			}
			require.Equal(t, want, sends)
		})
	}
}
func TestTelegramLoginPrivacyFreshRolesAndSwitches(t *testing.T) {
	n, _ := telegramTrafficFixture(t)
	e := LoginNotice{UserID: 10, Account: "owner\nspoof", Method: "账号密码", IP: "203.0.113.1", At: time.Now(), Reason: LoginBadPassword}
	require.True(t, telegramLoginAllowed(n, e))
	e.UserID = 999
	require.False(t, telegramLoginAllowed(n, e))
	e.UserID = 0
	require.False(t, telegramLoginAllowed(n, e))
	n.UserID = 1
	require.NoError(t, DB.Save(n).Error)
	require.True(t, telegramLoginAllowed(n, e))
	sends := 0
	factory := func(target model.TelegramMenuTarget) *telegramAPI {
		api := newTelegramAPI(target)
		api.client.Transport = telegramRoundTrip(func(r *http.Request) (*http.Response, error) {
			sends++
			raw, err := io.ReadAll(r.Body)
			require.NoError(t, err)
			require.Contains(t, string(raw), "密码错误")
			require.NotContains(t, string(raw), "fixture_token")
			require.NotContains(t, string(raw), "owner\\nspoof")
			return telegramTestResponse(nil), nil
		})
		return api
	}
	telegramSendLogin(context.Background(), e, factory)
	require.Equal(t, 1, sends)
	require.NoError(t, DB.Model(&model.User{}).Where("id = ?", 1).Update("role", model.RoleMember).Error)
	telegramSendLogin(context.Background(), e, factory)
	require.Equal(t, 1, sends)
	e.UserID = 1
	n.TelegramMenu.LoginFailure = false
	require.False(t, telegramLoginAllowed(n, e))
	e.Reason = LoginSucceeded
	require.True(t, telegramLoginAllowed(n, e))
	n.TelegramMenu.Enabled = false
	require.False(t, telegramLoginAllowed(n, e))
}
func TestTelegramLoginBoundedNonblockingQueueAndAllowlist(t *testing.T) {
	for len(loginNotices) > 0 {
		<-loginNotices
	}
	loginNoticeLimit.Lock()
	loginNoticeLimit.start = [2]time.Time{}
	loginNoticeLimit.counts = [2]int{}
	loginNoticeLimit.suppressed = [2]int{}
	loginNoticeLimit.Unlock()
	for i := 0; i < 100; i++ {
		PublishLoginNotice(LoginNotice{Account: "a\nb", Method: "untrusted-secret", IP: "not-an-ip", Reason: LoginBadPassword})
	}
	require.Len(t, loginNotices, 10)
	for len(loginNotices) > 0 {
		e := <-loginNotices
		require.Equal(t, "a b", e.Account)
		require.Equal(t, "OAuth2", e.Method)
		require.Equal(t, "未知", e.IP)
		require.NotContains(t, telegramLoginText(e), "untrusted-secret")
	}
	loginNoticeLimit.Lock()
	loginNoticeLimit.start = [2]time.Time{}
	loginNoticeLimit.counts = [2]int{}
	loginNoticeLimit.suppressed = [2]int{}
	loginNoticeLimit.Unlock()
}

func TestTelegramLoginNoRedundantFooter(t *testing.T) {
	const footer = "不记录或发送密码、验证码、恢复码。"
	for _, method := range []string{"账号密码", "GitHub", "OAuth2"} {
		for reason := LoginSucceeded; reason <= LoginInternalError; reason++ {
			e := LoginNotice{Account: "fixture-user", Method: method, IP: "203.0.113.1", Reason: reason, At: trafficTime("2026-10-10T21:00:00+08:00"), Suppressed: 2}
			text := telegramLoginText(e)
			require.Contains(t, text, "账号：fixture-user")
			require.Contains(t, text, "方式："+method)
			require.Contains(t, text, "来源 IP：203.0.113.1")
			require.Contains(t, text, "另有 2 次同类提醒")
			if reason == LoginSucceeded {
				require.Contains(t, text, "✅ 登录提醒")
				require.Contains(t, text, "结果：验证通过")
				require.NotContains(t, text, footer)
			} else {
				require.Contains(t, text, "⚠️ 登录失败提醒")
				require.NotContains(t, text, footer)
			}
		}
	}
}
