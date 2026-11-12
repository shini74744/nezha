package singleton

import (
	"fmt"
	"net/netip"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/nezhahq/nezha/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var SSHLoginMu sync.Mutex
var sshDeliveryMu sync.Mutex

func SSHLoginPolicyFor(uuid string) (model.SSHLoginPolicy, error) {
	p := model.DefaultSSHLoginPolicy()
	p.UUID = uuid
	err := DB.Omit("block_data").Where("uuid = ?", uuid).Limit(1).Find(&p).Error
	return p, err
}
func ReceiveSSHLogin(uuid string, r model.SSHLoginReport, now time.Time) (model.SSHLoginReply, error) {
	SSHLoginMu.Lock()
	defer SSHLoginMu.Unlock()
	p, err := SSHLoginPolicyFor(uuid)
	reply := model.SSHLoginReply{Policy: p, Unban: []model.SSHUnbanCommand{}}
	if err != nil {
		return reply, err
	}
	if p.BlockHash != r.Status.ReceivedHash {
		var bundle model.SSHLoginPolicy
		if err = DB.Select("block_data").Where("uuid = ?", uuid).Limit(1).Find(&bundle).Error; err != nil {
			return reply, err
		}
		reply.PrefixesGzip = bundle.BlockData
	}
	if e := validateSSHBanPage(r.BanPage); e != nil {
		return reply, e
	}
	if len(r.Status.ImportedAllowlist) > 100 || len(r.Recent) > 50 || len(r.Events) > 100 || len(r.Completed) > 32 || len(r.Status.Banned) > 1000 || len(r.Status.Ports) > 128 || len(r.Status.Message) > 512 || len(r.Status.Source) > 100 {
		return reply, fmt.Errorf("SSH report too large")
	}
	if r.Status.Backend != "" && r.Status.Backend != "native" && r.Status.Backend != "fail2ban" {
		return reply, fmt.Errorf("invalid SSH backend")
	}
	if p.Engine() == "fail2ban" && !r.Status.BackendSelection {
		// Old Agents ignore unknown JSON fields: never let them apply a Fail2ban policy as native.
		return model.SSHLoginReply{}, fmt.Errorf("Fail2ban policy requires an upgraded Linux Agent")
	}
	if strings.IndexFunc(r.Status.Message+r.Status.Source, unicode.IsControl) >= 0 {
		return reply, fmt.Errorf("invalid status")
	}
	for _, ip := range r.Status.ImportedAllowlist {
		if _, e := netip.ParseAddr(ip); e != nil {
			if _, e = netip.ParsePrefix(ip); e != nil {
				return reply, fmt.Errorf("invalid imported allowlist")
			}
		}
	}
	for _, ip := range r.Status.Banned {
		if a, e := netip.ParseAddr(ip); e != nil || a.Zone() != "" {
			return reply, fmt.Errorf("invalid blocked IP")
		}
	}
	for _, e := range append(append([]model.SSHLoginEvent{}, r.Events...), r.Recent...) {
		if err = e.Validate(now.UnixMilli()); err != nil {
			return reply, err
		}
	}
	err = DB.Transaction(func(tx *gorm.DB) error {
		if len(r.Completed) > 0 {
			if e := tx.Model(&model.SSHUnbanCommand{}).Where("uuid = ? AND id IN ?", uuid, r.Completed).Update("done", true).Error; e != nil {
				return e
			}
		}
		if p.Enabled {
			for _, e := range r.Events {
				if e.Port != 0 && !slices.Contains(p.Ports, e.Port) {
					continue
				}
				if (e.Success && !p.Success) || (!e.Success && !p.Failure) {
					continue
				}
				receipt := model.SSHLoginReceipt{UUID: uuid, ID: e.ID, AcceptedAt: now.Unix()}
				result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&receipt)
				if result.Error != nil {
					return result.Error
				}
				if result.RowsAffected == 0 {
					continue
				}
				e.UUID = uuid
				e.ReceivedAt = now.Unix()
				e.SentAt = 0
				e.RetryAt = 0
				if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&e).Error; err != nil {
					return err
				}
			}
		}
		return tx.Where("uuid = ? AND done = ? AND created_at > ?", uuid, false, now.Add(-10*time.Minute).Unix()).Order("id").Limit(32).Find(&reply.Unban).Error
	})
	if err == nil {
		reply.QueryID = observeSSHLocal(uuid, r, now)
		reply.BanQuery = observeSSHBans(uuid, r.BanPage, now)
	}
	return reply, err
}

func SSHLoginMessage(s *model.Server, events []model.SSHLoginEvent) string {
	first, last := events[0], events[len(events)-1]
	title := "❌ SSH 登录失败"
	if first.Success {
		title = "✅ SSH 登录成功"
	}
	port := "未能确认"
	if first.Port > 0 {
		port = fmt.Sprint(first.Port)
	}
	method := first.Method
	switch method {
	case "password":
		method = "密码"
	case "publickey":
		method = "公钥"
	case "keyboard-interactive/pam":
		method = "交互认证"
	}
	reason := first.Reason
	if first.Success {
		reason = "认证成功"
	}
	lines := []string{title, fmt.Sprintf("服务器：%s（ID：%d）", s.Name, s.ID), "尝试账号：" + first.Username, "来源 IP：" + first.SourceIP, "SSH 端口：" + port, "认证方式：" + method, "结果：" + reason, fmt.Sprintf("次数：%d", len(events)), "时间：" + time.UnixMilli(first.Time).In(model.PlanTrafficZone).Format("2006-01-02 15:04:05") + "（北京时间）"}
	if last.Time != first.Time {
		lines = append(lines, "最后一次："+time.UnixMilli(last.Time).In(model.PlanTrafficZone).Format("2006-01-02 15:04:05"))
	}
	return strings.Join(lines, "\n")
}

func (c *NotificationClass) sshRecipients(group uint64, kind string) []*model.Notification {
	c.listMu.RLock()
	defer c.listMu.RUnlock()
	out := []*model.Notification{}
	for _, n := range c.groupToIDList[group] {
		if !n.EventDisabled(kind) {
			out = append(out, n)
		}
	}
	return out
}
func SendSSHLoginNotifications() {
	if !sshDeliveryMu.TryLock() {
		return
	}
	defer sshDeliveryMu.Unlock()
	_ = sendSSHLoginNotifications(time.Now(), func(n *model.Notification, s *model.Server, events []model.SSHLoginEvent) error {
		kind := "ssh_failure"
		if events[0].Success {
			kind = "ssh_success"
		}
		ns := model.NotificationServerBundle{Notification: n, Loc: Loc, Event: &model.NotificationEvent{Kind: kind, ServerID: s.ID, ServerName: s.Name}}
		return ns.Send(SSHLoginMessage(s, events))
	})
}

type SSHLoginDelivery struct {
	UUID           string `gorm:"primaryKey;size:64"`
	EventID        string `gorm:"primaryKey;size:64"`
	NotificationID uint64 `gorm:"primaryKey"`
	SentAt         int64  `gorm:"index"`
}

func sendSSHLoginNotifications(now time.Time, send func(*model.Notification, *model.Server, []model.SSHLoginEvent) error) error {
	if NotificationShared == nil {
		return nil
	}
	var rows []model.SSHLoginEvent
	if err := DB.Where("sent_at = 0 AND retry_at <= ? AND (success = ? OR received_at <= ?)", now.Unix(), true, now.Add(-time.Minute).Unix()).Order("time, id").Limit(500).Find(&rows).Error; err != nil {
		return err
	}
	type groupKey struct {
		UUID, IP, Username, Method, SuccessID string
		Port                                  uint16
		Minute                                int64
	}
	groups := map[groupKey][]model.SSHLoginEvent{}
	for _, e := range rows {
		key := groupKey{UUID: e.UUID, IP: e.SourceIP, Username: e.Username, Port: e.Port, Method: e.Method, Minute: e.ReceivedAt / 60}
		if e.Success {
			key.SuccessID = e.ID
		}
		groups[key] = append(groups[key], e)
	}
	for _, events := range groups {
		e := events[0]
		var server model.Server
		p, err := SSHLoginPolicyFor(e.UUID)
		if err != nil {
			return err
		}
		if err = DB.Select("id", "uuid", "name").Where("uuid = ?", e.UUID).First(&server).Error; err != nil && err != gorm.ErrRecordNotFound {
			return err
		}
		kind := "ssh_failure"
		if e.Success {
			kind = "ssh_success"
		}
		recipients := []*model.Notification{}
		if err == nil && p.Enabled && ((e.Success && p.Success) || (!e.Success && p.Failure)) {
			recipients = NotificationShared.sshRecipients(p.NotificationGroupID, kind)
		}
		ids := make([]string, len(events))
		for i := range events {
			ids[i] = events[i].ID
		}
		ok := true
		for _, n := range recipients {
			var delivered []SSHLoginDelivery
			if err = DB.Where("uuid = ? AND event_id IN ? AND notification_id = ?", e.UUID, ids, n.ID).Find(&delivered).Error; err != nil {
				return err
			}
			seen := map[string]bool{}
			for _, v := range delivered {
				seen[v.EventID] = true
			}
			pending := []model.SSHLoginEvent{}
			for _, v := range events {
				if !seen[v.ID] {
					pending = append(pending, v)
				}
			}
			if len(pending) == 0 {
				continue
			}
			if err = send(n, &server, pending); err != nil {
				ok = false
				continue
			}
			ledgers := make([]SSHLoginDelivery, 0, len(pending))
			for _, v := range pending {
				ledgers = append(ledgers, SSHLoginDelivery{UUID: e.UUID, EventID: v.ID, NotificationID: n.ID, SentAt: now.Unix()})
			}
			if err = DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&ledgers).Error; err != nil {
				return err
			}
		}
		values := map[string]any{"retry_at": now.Add(time.Minute).Unix()}
		if ok {
			if err = DB.Where("uuid = ? AND id IN ?", e.UUID, ids).Delete(&model.SSHLoginEvent{}).Error; err != nil {
				return err
			}
			continue
		}
		if err = DB.Model(&model.SSHLoginEvent{}).Where("uuid = ? AND id IN ?", e.UUID, ids).Updates(values).Error; err != nil {
			return err
		}
	}
	// Bounded retention for authentication metadata; unrelated histories are untouched.
	cutoff := now.Add(-24 * time.Hour).UnixMilli()
	if err := DB.Where("accepted_at < ?", now.Add(-48*time.Hour).Unix()).Delete(&model.SSHLoginReceipt{}).Error; err != nil {
		return err
	}
	if err := DB.Where("time < ?", cutoff).Delete(&model.SSHLoginEvent{}).Error; err != nil {
		return err
	}
	if err := DB.Where("sent_at < ?", now.Add(-48*time.Hour).Unix()).Delete(&SSHLoginDelivery{}).Error; err != nil {
		return err
	}
	return DB.Where("created_at < ?", now.Add(-24*time.Hour).Unix()).Delete(&model.SSHUnbanCommand{}).Error
}
