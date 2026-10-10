package singleton

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/netip"
	"sync"
	"time"

	"github.com/nezhahq/nezha/model"
	"gorm.io/gorm/clause"
)

// Fixed outcome codes. OTPs, recovery codes, cookies and tokens are never captured.
type LoginNoticeReason uint8

const (
	LoginSucceeded LoginNoticeReason = iota
	LoginInvalidRequest
	LoginUnknownAccount
	LoginPasswordDisabled
	LoginBadPassword
	LoginBadFactor
	LoginFactorLimited
	LoginOAuthFailed
	LoginOAuthUnbound
	LoginChallengeExpired
	LoginInternalError
)

type LoginNotice struct {
	UserID              uint64
	Account, Method, IP string
	Reason              LoginNoticeReason
	At                  time.Time
	Suppressed          int
	AttemptedPassword   *LoginAttemptPassword `json:"-"`
}

var loginNotices = make(chan LoginNotice, 64)
var loginNoticeLimit = struct {
	sync.Mutex
	start              [2]time.Time
	counts, suppressed [2]int
}{}

// Non-blocking, bounded and process-local: delivery never controls login success.
func PublishLoginNotice(e LoginNotice) {
	e.At = time.Now()
	e.Account = telegramSafeName(e.Account)
	if e.Method != "账号密码" && e.Method != "GitHub" {
		e.Method = "OAuth2"
	}
	if ip, err := netip.ParseAddr(e.IP); err == nil {
		e.IP = ip.String()
	} else {
		e.IP = "未知"
	}
	if e.Reason > LoginInternalError {
		e.Reason = LoginInternalError
	}
	if !passwordLoginFailure(e) {
		e.AttemptedPassword = nil
	}
	kind, limit := 0, 10
	if e.Reason == LoginSucceeded {
		kind, limit = 1, 20
	}
	loginNoticeLimit.Lock()
	defer loginNoticeLimit.Unlock()
	if e.At.Sub(loginNoticeLimit.start[kind]) >= time.Minute {
		loginNoticeLimit.start[kind] = e.At
		loginNoticeLimit.counts[kind] = 0
	}
	if loginNoticeLimit.counts[kind] >= limit {
		loginNoticeLimit.suppressed[kind]++
		return
	}
	e.Suppressed = loginNoticeLimit.suppressed[kind]
	select {
	case loginNotices <- e:
		loginNoticeLimit.counts[kind]++
		loginNoticeLimit.suppressed[kind] = 0
	default:
		loginNoticeLimit.suppressed[kind]++
	}
}
func telegramLoginText(e LoginNotice) string {
	reasons := []string{"验证通过", "登录信息格式错误或不完整", "账号不存在", "该账号已关闭密码登录", "密码错误",
		"动态验证码或恢复码错误、过期或已使用", "验证码尝试过多，请稍后再试", "OAuth授权校验失败", "OAuth账号未绑定面板账号", "登录验证已失效，请重新登录", "登录服务暂时不可用"}
	title := "⚠️ 登录失败提醒"
	if e.Reason == LoginSucceeded {
		title = "✅ 登录提醒"
	}
	account := telegramSafeName(e.Account)
	if account == "" {
		account = "未识别"
	}
	reason := "登录服务暂时不可用"
	if int(e.Reason) < len(reasons) {
		reason = reasons[e.Reason]
	}
	text := fmt.Sprintf("%s\n时间：%s（北京时间）\n账号：%s\n方式：%s\n来源 IP：%s\n结果：%s", title, e.At.In(model.PlanTrafficZone).Format("2006-01-02 15:04:05"), account, e.Method, e.IP, reason)
	if passwordLoginFailure(e) && e.AttemptedPassword != nil {
		text += "\n密码：" + e.AttemptedPassword.display()
	}
	if e.Suppressed > 0 {
		text += fmt.Sprintf("\n另有 %d 次同类提醒因防刷或队列繁忙未逐条发送。", e.Suppressed)
	}
	return text
}
func telegramLoginAllowed(n *model.Notification, e LoginNotice) bool {
	if n.TelegramMenu == nil || !n.TelegramMenu.Enabled {
		return false
	}
	if e.Reason == LoginSucceeded && !n.TelegramMenu.LoginSuccess {
		return false
	}
	if e.Reason != LoginSucceeded && !n.TelegramMenu.LoginFailure {
		return false
	}
	var owner model.User
	if DB.Select("id", "role").First(&owner, n.UserID).Error != nil {
		return false
	}
	return owner.Role == model.RoleAdmin || (owner.Role == model.RoleMember && e.UserID != 0 && e.UserID == owner.ID)
}
func telegramReportNotifications(ctx context.Context) []model.Notification {
	if DB == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	var list []model.Notification
	if DB.WithContext(ctx).Where("telegram_menu IS NOT NULL").Find(&list).Error != nil {
		return nil
	}
	return list
}
func telegramSendLogin(ctx context.Context, e LoginNotice, factory func(model.TelegramMenuTarget) *telegramAPI) {
	if time.Since(e.At) > 5*time.Minute {
		return
	}
	for _, n := range telegramReportNotifications(ctx) {
		if ctx.Err() != nil {
			return
		}
		if !telegramLoginAllowed(&n, e) {
			continue
		}
		target, err := n.TelegramMenuTarget()
		if err != nil {
			continue
		}
		// Re-check after gathering recipients; an old queued event cannot use a removed binding.
		if !telegramBindingCurrent(&n, telegramMenuBinding(&n)) {
			continue
		}
		recipientEvent := e
		// No cross-account secrets, even for administrators receiving global alerts.
		if !n.TelegramMenu.LoginFailurePassword || (e.UserID != 0 && e.UserID != n.UserID) {
			recipientEvent.AttemptedPassword = nil
		}
		if e.UserID != 0 {
			var user model.User
			if DB.Select("id", "role").First(&user, e.UserID).Error == nil && user.Role == model.RoleAdmin {
				recipientEvent.Account = "管理员"
			}
		}
		call, cancel := context.WithTimeout(ctx, 8*time.Second)
		err = factory(target).call(call, "sendMessage", map[string]any{"chat_id": target.ChatID, "text": telegramLoginText(recipientEvent), "link_preview_options": map[string]bool{"is_disabled": true}}, nil)
		cancel()
		if err != nil {
			log.Printf("NEZHA>> TelegramLogin::notification=%d delivery_failed", n.ID)
		}
	}
}
func telegramSendDaily(ctx context.Context, n *model.Notification, now time.Time, api *telegramAPI) error {
	if n.TelegramMenu == nil || !n.TelegramMenu.Enabled || !n.TelegramMenu.DailyTraffic {
		return nil
	}
	day := now.In(model.PlanTrafficZone).AddDate(0, 0, -1)
	date := day.Format("2006-01-02")
	db := DB.WithContext(ctx)
	// First enabling starts with the next midnight, not an unexpected old report.
	initial := model.TelegramDailyDelivery{NotificationID: n.ID, LastDay: date, State: "initialized"}
	if err := db.Clauses(clause.OnConflict{DoNothing: true}).Create(&initial).Error; err != nil {
		return err
	}
	var cursor model.TelegramDailyDelivery
	if err := db.First(&cursor, n.ID).Error; err != nil {
		return err
	}
	if cursor.LastDay >= date {
		return nil
	}
	if cursor.ClaimDay == date && (cursor.State != "retry" || cursor.RetryAt > now.Unix() || cursor.Attempts >= 5) {
		return nil
	}
	rows, err := telegramServerRows(n.UserID, now)
	if err != nil {
		return err
	}
	sum, err := telegramTrafficQuery(ctx, rows, day, now)
	if err != nil {
		return err
	}
	if !telegramBindingCurrent(n, telegramMenuBinding(n)) {
		return nil
	}
	attempts := 1
	if cursor.ClaimDay == date {
		attempts = cursor.Attempts + 1
	}
	// Compare-and-swap also guards simultaneous scheduler ticks.
	result := db.Model(&model.TelegramDailyDelivery{}).Where("notification_id = ? AND last_day = ? AND claim_day = ? AND state = ? AND attempts = ?", n.ID, cursor.LastDay, cursor.ClaimDay, cursor.State, cursor.Attempts).
		Updates(map[string]any{"claim_day": date, "state": "sending", "attempts": attempts, "retry_at": 0})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return nil
	}
	call, cancel := context.WithTimeout(ctx, 8*time.Second)
	err = api.call(call, "sendMessage", map[string]any{"chat_id": api.target.ChatID, "text": telegramDailyText(sum),
		"reply_markup":         telegramFilterKeyboard(telegramKeyboard{Rows: [][]telegramButton{{{Text: "查看当日明细", Data: "nzsm:day" + date + ":0"}, {Text: "今日流量", Data: "nzsm:traffic:0"}}}}, n.TelegramMenu),
		"link_preview_options": map[string]bool{"is_disabled": true}}, nil)
	cancel()
	update := map[string]any{"state": "sent", "last_day": date}
	if err != nil {
		update = map[string]any{"state": "uncertain"}
		var apiErr *telegramAPIError
		// Only an explicit rejection can safely be retried without duplicating a delivered report.
		if errors.As(err, &apiErr) && apiErr.Code == 429 {
			update = map[string]any{"state": "retry", "retry_at": now.Add(time.Duration(max(60, min(3600, apiErr.RetryAfter))) * time.Second).Unix()}
		} else if errors.As(err, &apiErr) && apiErr.Code >= 400 && apiErr.Code < 500 {
			update = map[string]any{"state": "rejected"}
		}
		log.Printf("NEZHA>> TelegramDaily::notification=%d day=%s delivery_not_confirmed", n.ID, date)
	}
	if saveErr := db.Model(&model.TelegramDailyDelivery{}).Where("notification_id = ? AND claim_day = ?", n.ID, date).Updates(update).Error; saveErr != nil {
		return saveErr
	}
	return err
}
func runTelegramReports(ctx context.Context) {
	daily := func() {
		for _, n := range telegramReportNotifications(ctx) {
			if ctx.Err() != nil {
				return
			}
			if n.TelegramMenu == nil || !n.TelegramMenu.Enabled || !n.TelegramMenu.DailyTraffic {
				continue
			}
			target, err := n.TelegramMenuTarget()
			if err != nil {
				continue
			}
			call, cancel := context.WithTimeout(ctx, 15*time.Second)
			if err := telegramSendDaily(call, &n, time.Now(), newTelegramAPI(target)); err != nil && ctx.Err() == nil {
				log.Printf("NEZHA>> TelegramDaily::notification=%d report_failed", n.ID)
			}
			cancel()
		}
	}
	daily()
	tick := time.NewTicker(10 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case e := <-loginNotices:
			telegramSendLogin(ctx, e, newTelegramAPI)
		case <-tick.C:
			daily()
		}
	}
}
