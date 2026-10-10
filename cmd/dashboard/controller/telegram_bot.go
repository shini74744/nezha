package controller

import (
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
)

// This dedicated view never includes bot tokens, chat IDs or webhook bodies.
type telegramBotSettings struct {
	ID       uint64                       `json:"id"`
	Name     string                       `json:"name"`
	Config   model.TelegramMenuConfig     `json:"config"`
	Eligible bool                         `json:"eligible"`
	Reason   string                       `json:"reason,omitempty"`
	Status   singleton.TelegramMenuStatus `json:"status"`
}

func isTelegramBotNotification(n *model.Notification) bool {
	u, err := url.Parse(n.URL)
	return n.TelegramMenu != nil || (err == nil && u.Hostname() == "api.telegram.org" && strings.HasPrefix(u.Path, "/bot") && strings.HasSuffix(u.Path, "/sendMessage"))
}

func telegramBotSettingsView(n *model.Notification) telegramBotSettings {
	config := model.TelegramMenuConfig{ExpiryDays: 7}
	if n.TelegramMenu != nil {
		config = *n.TelegramMenu
	}
	_, err := n.TelegramMenuTarget()
	view := telegramBotSettings{ID: n.ID, Name: n.Name, Config: config, Eligible: err == nil, Status: singleton.GetTelegramMenuStatus(n)}
	if err != nil {
		view.Reason = "请先将此 TG 通知配置为有效的机器人私聊通知。"
	}
	return view
}

func listTelegramBots(c *gin.Context) ([]telegramBotSettings, error) {
	c.Header("Cache-Control", "no-store")
	var notifications []model.Notification
	if err := singleton.DB.Order("id ASC").Find(&notifications).Error; err != nil {
		return nil, err
	}
	result := make([]telegramBotSettings, 0)
	for i := range notifications {
		n := &notifications[i]
		if n.HasPermission(c) && isTelegramBotNotification(n) {
			result = append(result, telegramBotSettingsView(n))
		}
	}
	return result, nil
}

func saveTelegramBot(c *gin.Context) (*telegramBotSettings, error) {
	c.Header("Cache-Control", "no-store")
	if _, pat := c.Get(model.CtxKeyAPIToken); pat {
		return nil, errors.New("请通过浏览器登录账号设置 TG 机器人")
	}
	notificationMenuSaveMu.Lock()
	defer notificationMenuSaveMu.Unlock()
	n, err := notificationEditor(c)
	if err != nil {
		return nil, err
	}
	if !isTelegramBotNotification(n) {
		return nil, errors.New("请先添加 TG 通知")
	}
	var request struct {
		Config *model.TelegramMenuConfig `json:"telegram_menu"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16384)
	if err := c.ShouldBindJSON(&request); err != nil || request.Config == nil {
		return nil, errors.New("无效的 TG 机器人配置")
	}
	if err := checkTelegramMenuSave(c, n, request.Config); err != nil {
		return nil, err
	}
	// Persist only bot settings: never overwrite notification credentials/templates.
	if err := singleton.DB.Model(n).Select("TelegramMenu", "UpdatedAt").Updates(n).Error; err != nil {
		return nil, err
	}
	singleton.NotificationShared.Update(n)
	view := telegramBotSettingsView(n)
	return &view, nil
}

// A pointer keeps the empty array in CommonResponse's omitempty data field.
func telegramBotsResponse(c *gin.Context) (*[]telegramBotSettings, error) {
	rows, err := listTelegramBots(c)
	return &rows, err
}
