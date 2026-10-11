package singleton

import (
	"fmt"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/telegramauth"
	"time"
)

type telegramWebApp struct {
	URL string `json:"url"`
}
type TelegramTerminalLaunch struct {
	NotificationID uint64
	Binding        string
}

var telegramTerminalLaunches telegramauth.Store[TelegramTerminalLaunch]

func TelegramTerminalBinding(n *model.Notification) string { return telegramMenuBinding(n) }
func GetTelegramTerminalLaunch(token string, now time.Time, consume bool) (TelegramTerminalLaunch, bool) {
	return telegramTerminalLaunches.Get(token, now, consume)
}
func telegramTerminalView(n *model.Notification, now time.Time) (telegramMenuView, error) {
	if n.TelegramMenu == nil || !n.TelegramMenu.Enabled || !n.TelegramMenu.Terminal || n.ValidateTelegramMenu() != nil {
		return telegramMenuView{Text: "网页终端已关闭。"}, nil
	}
	launch, err := NewTelegramTerminalLaunch(n, now)
	if err != nil {
		return telegramMenuView{Text: "打开次数较多，请稍后重试。"}, nil
	}
	// Fragment never reaches HTTP access logs or Referer. It alone grants nothing:
	// the API also requires fresh Telegram-signed identity matching the recipient.
	link := fmt.Sprintf("%s/telegram-terminal/#launch=%s", n.TelegramMenu.TerminalOrigin, launch)
	return telegramMenuView{Text: "⌨️ 网页终端\n\n先选择服务器，支持名称、ID 模糊搜索。\n仅绑定的 TG 账号可用，入口 5 分钟内有效。",
		Markup: telegramKeyboard{Rows: [][]telegramButton{{{Text: "选择服务器", WebApp: &telegramWebApp{URL: link}}}}}}, nil
}

func NewTelegramTerminalLaunch(n *model.Notification, now time.Time) (string, error) {
	if n == nil || n.TelegramMenu == nil || !n.TelegramMenu.Enabled || !n.TelegramMenu.Terminal || n.ValidateTelegramMenu() != nil {
		return "", telegramauth.ErrDenied
	}
	return telegramTerminalLaunches.Put(TelegramTerminalLaunch{n.ID, telegramMenuBinding(n)}, n.ID, now.Add(5*time.Minute), now)
}
