package model

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// Opt-in and private-chat only. The recipient's numeric chat ID is also the
// Telegram user allowlist; membership in a group never grants panel access.
type TelegramMenuConfig struct {
	Enabled              bool            `json:"enabled"`
	ExpiryDays           int             `json:"expiry_days"`
	LoginSuccess         bool            `json:"login_success"`
	LoginFailure         bool            `json:"login_failure"`
	LoginFailurePassword bool            `json:"login_failure_password"`
	DailyTraffic         bool            `json:"daily_traffic"`
	Items                map[string]bool `json:"items,omitempty"`
}

// Missing switches retain the original menu behavior when upgrading.
func (m *TelegramMenuConfig) ItemEnabled(kind string) bool {
	switch kind {
	case "home", "online", "offline", "expiry", "traffic":
		if m != nil {
			if enabled, exists := m.Items[kind]; exists {
				return enabled
			}
		}
		return true
	default:
		return false
	}
}

type TelegramMenuCursor struct {
	BotKey     string `gorm:"primaryKey;size:64"`
	NextUpdate int64
}
type TelegramMenuTarget struct {
	Token  string
	ChatID int64
	BotKey string
}

var telegramMenuToken = regexp.MustCompile(`^[0-9]{3,20}:[A-Za-z0-9_-]{8,128}$`)

func (n *Notification) TelegramMenuTarget() (TelegramMenuTarget, error) {
	bad := errors.New("服务器管理菜单仅支持 Telegram 官方 HTTPS 地址和数字私聊 Chat ID")
	u, body, err := n.telegramEventRequest()
	if err != nil || u.Scheme != "https" || u.Host != "api.telegram.org" || u.User != nil || u.Fragment != "" {
		return TelegramMenuTarget{}, bad
	}
	token := strings.TrimSuffix(strings.TrimPrefix(u.Path, "/bot"), "/sendMessage")
	if !telegramMenuToken.MatchString(token) || u.Path != "/bot"+token+"/sendMessage" {
		return TelegramMenuTarget{}, bad
	}
	raw := u.Query().Get("chat_id")
	if chat, ok := body["chat_id"]; ok {
		raw = fmt.Sprint(chat)
	}
	// Existing JSON numbers may be represented as float64. Avoid exponential notation.
	if chat, ok := body["chat_id"].(float64); ok {
		if chat != float64(int64(chat)) {
			return TelegramMenuTarget{}, bad
		}
		raw = strconv.FormatInt(int64(chat), 10)
	}
	chat, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || chat <= 0 || chat >= 1<<52 {
		return TelegramMenuTarget{}, bad
	}
	if v, ok := body["message_thread_id"]; ok && fmt.Sprint(v) != "" && fmt.Sprint(v) != "0" {
		return TelegramMenuTarget{}, bad
	}
	if v := u.Query().Get("message_thread_id"); v != "" && v != "0" {
		return TelegramMenuTarget{}, bad
	}
	sum := sha256.Sum256([]byte(token))
	return TelegramMenuTarget{Token: token, ChatID: chat, BotKey: hex.EncodeToString(sum[:])}, nil
}
func (n *Notification) ValidateTelegramMenu() error {
	if n.TelegramMenu == nil {
		return nil
	}
	for key := range n.TelegramMenu.Items {
		switch key {
		case "home", "online", "offline", "expiry", "traffic":
		default:
			return errors.New("无效的 TG 菜单选项")
		}
	}
	if !n.TelegramMenu.Enabled {
		return nil
	}
	if n.TelegramMenu.ExpiryDays < 1 || n.TelegramMenu.ExpiryDays > 365 {
		return errors.New("即将到期范围必须为 1–365 天")
	}
	_, err := n.TelegramMenuTarget()
	return err
}
