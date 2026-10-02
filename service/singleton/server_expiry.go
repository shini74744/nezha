package singleton

import (
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/nezhahq/nezha/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var serverExpiryMu sync.Mutex

func GetServerExpiryConfig() (model.ServerExpiryConfig, error) {
	c := model.DefaultServerExpiryConfig()
	err := DB.Where("id = ?", 1).Limit(1).Find(&c).Error
	return c, err
}
func ServerExpiryMessage(s *model.Server, b model.ServerBilling, stage int, now time.Time) string {
	when := "已到期"
	if b.ExpiresAt > now.Unix() {
		when = fmt.Sprintf("剩余约 %d 天（提前 %d 天提醒）", b.RemainingDays, stage)
	}
	formatDate := func(raw string) string {
		if parsed, err := model.ParseBillingDate(raw); err == nil {
			return parsed.In(model.PlanTrafficZone).Format("2006-01-02 15:04:05")
		}
		return raw
	}
	start := formatDate(b.StartDate)
	if start == "" {
		start = "未设置"
	}
	cycle := b.Cycle
	if cycle == "" {
		cycle = "未设置"
	}
	amount := b.Amount
	if amount == "" {
		amount = "未设置"
	}
	renewal := "关闭"
	if b.AutoRenewal {
		renewal = "开启，按付款周期续算"
	}
	if b.RenewalWarning != "" {
		renewal = b.RenewalWarning
	}
	return fmt.Sprintf("⏰ 服务器到期通知（北京时间 UTC+8）\n服务器：%s（ID：%d）\n首次购买日期：%s\n原始到期日期：%s\n最新到期日期：%s\n本次提醒到期日期：%s\n付款周期：%s\n价格：%s\n状态：%s\n自动续费：%s（按周期推算，不代表实际付款）",
		s.Name, s.ID, start, formatDate(b.EndDate), formatDate(b.LatestEndDate), time.Unix(b.ExpiresAt, 0).In(model.PlanTrafficZone).Format("2006-01-02 15:04:05"), cycle, amount, when, renewal)
}
func (c *NotificationClass) expiryRecipients(group uint64) []*model.Notification {
	c.listMu.RLock()
	defer c.listMu.RUnlock()
	list := make([]*model.Notification, 0, len(c.groupToIDList[group]))
	for _, n := range c.groupToIDList[group] {
		if !n.EventDisabled("server_expiry") {
			list = append(list, n)
		}
	}
	return list
}

type expirySender func(*model.Notification, *model.Server, model.ServerBilling, int, time.Time) error

func sendServerExpiry(n *model.Notification, s *model.Server, b model.ServerBilling, stage int, now time.Time) error {
	// Use a safe default for Telegram modules missing the new event; generic
	// webhooks still receive their existing NEZHA template, without live metrics.
	copyN := *n
	if n.EventTemplates != nil && n.EventTemplates.Enabled {
		conf := *n.EventTemplates
		conf.Modules = make(map[string]model.NotificationEventModule, len(n.EventTemplates.Modules)+1)
		for k, v := range n.EventTemplates.Modules {
			conf.Modules[k] = v
		}
		if _, ok := conf.Modules["server_expiry"]; !ok {
			conf.Modules["server_expiry"] = model.NotificationEventModule{Mode: "fields", Fields: []string{"details"}}
		}
		copyN.EventTemplates = &conf
	}
	event := model.NotificationEvent{Kind: "server_expiry", ServerName: s.Name, ServerID: s.ID}
	ns := model.NotificationServerBundle{Notification: &copyN, Event: &event, Loc: Loc}
	return ns.Send(ServerExpiryMessage(s, b, stage, now))
}
func CheckServerExpiry() {
	if !serverExpiryMu.TryLock() {
		return
	}
	defer serverExpiryMu.Unlock()
	if err := checkServerExpiry(time.Now(), sendServerExpiry); err != nil {
		log.Printf("NEZHA>> server expiry check failed: %v", err)
	}
}
func checkServerExpiry(now time.Time, send expirySender) error {
	conf, err := GetServerExpiryConfig()
	if err != nil || !conf.Enabled {
		return err
	}
	if err = conf.Validate(); err != nil {
		return err
	}
	if NotificationShared == nil {
		return fmt.Errorf("notification service unavailable")
	}
	recipients := NotificationShared.expiryRecipients(conf.NotificationGroupID)
	if len(recipients) == 0 {
		return fmt.Errorf("到期通知组没有可发送的通知")
	}
	// Read saved billing metadata, independent of agent online/offline state.
	var servers []*model.Server
	if err = DB.Select("id", "uuid", "name", "public_note").Find(&servers).Error; err != nil {
		return err
	}
	for _, s := range servers {
		if s.UUID == "" {
			continue
		}
		b := model.ParseServerBilling(s.PublicNote, now)
		if b.ExpiresAt == 0 {
			continue
		}
		for _, b := range b.ExpiryCandidates(now, conf.Days) {
			stage, due := model.ServerExpiryStage(time.Unix(b.ExpiresAt, 0), now, conf.Days)
			if !due {
				continue
			}
			for _, n := range recipients {
				key := model.ServerExpiryDelivery{UUID: s.UUID, ExpiresAt: b.ExpiresAt, Days: stage, NotificationID: n.ID}
				// Successful closer-to-expiry reminders suppress older stages after a clock
				// rollback or policy edit. The ledger remains durable across restarts.
				var sent int64
				if err = DB.Model(&model.ServerExpiryDelivery{}).Where("uuid = ? AND expires_at = ? AND notification_id = ? AND days <= ? AND sent_at > 0", s.UUID, b.ExpiresAt, n.ID, stage).Count(&sent).Error; err != nil {
					return err
				}
				if sent > 0 {
					continue
				}
				if err = DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&key).Error; err != nil {
					return err
				}
				var record model.ServerExpiryDelivery
				query := func() *gorm.DB {
					return DB.Where("uuid = ? AND expires_at = ? AND days = ? AND notification_id = ?", s.UUID, b.ExpiresAt, stage, n.ID)
				}
				if err = query().First(&record).Error; err != nil {
					return err
				}
				if record.SentAt > 0 || record.RetryAt > now.Unix() {
					continue
				}
				// Reserve before I/O: crashes/network uncertainty can retry after 5 minutes.
				if err = query().Model(&model.ServerExpiryDelivery{}).Updates(map[string]any{"retry_at": now.Add(5 * time.Minute).Unix(), "attempts": record.Attempts + 1}).Error; err != nil {
					return err
				}
				sendErr := send(n, s, b, stage, now)
				result := map[string]any{"last_error": "", "sent_at": now.Unix()}
				if sendErr != nil {
					result = map[string]any{"last_error": "发送失败，将重试；请检查通知配置或网络"}
					log.Printf("NEZHA>> server expiry delivery failed server=%d notifier=%d", s.ID, n.ID)
				} else {
					log.Printf("NEZHA>> server expiry delivery succeeded server=%d notifier=%d stage=%d", s.ID, n.ID, stage)
				}
				if err = query().Model(&model.ServerExpiryDelivery{}).Updates(result).Error; err != nil {
					return err
				}
			}
		}
	}
	return nil
}
