package singleton

import (
	"context"
	"github.com/nezhahq/nezha/model"
	"time"
)

func telegramMenuItemEnabled(config *model.TelegramMenuConfig, kind string) bool {
	if kind == "yesterday" || telegramTrafficDateKind(kind) {
		kind = "traffic"
	}
	return config.ItemEnabled(kind)
}

func telegramFilterKeyboard(keyboard telegramKeyboard, config *model.TelegramMenuConfig) telegramKeyboard {
	filtered := telegramKeyboard{Rows: make([][]telegramButton, 0)}
	for _, row := range keyboard.Rows {
		kept := make([]telegramButton, 0, len(row))
		for _, button := range row {
			kind, _, valid := telegramParseCallback(button.Data)
			if valid && telegramMenuItemEnabled(config, kind) {
				kept = append(kept, button)
			}
		}
		if len(kept) > 0 {
			filtered.Rows = append(filtered.Rows, kept)
		}
	}
	return filtered
}

// Gate before accessing server/traffic data, including commands and old messages.
func telegramConfiguredView(ctx context.Context, n *model.Notification, kind string, page int, now time.Time) (telegramMenuView, error) {
	if !telegramMenuItemEnabled(n.TelegramMenu, kind) {
		return telegramMenuView{Text: "该功能已关闭，请选择其他功能。", Markup: telegramFilterKeyboard(telegramKeyboard{Rows: append(telegramCategoryButtons(), []telegramButton{{Text: "服务器概览", Data: "nzsm:home:0"}})}, n.TelegramMenu)}, nil
	}
	rows, err := telegramServerRows(n.UserID, now)
	if err != nil {
		return telegramMenuView{}, err
	}
	view := telegramRender(rows, kind, page, n.TelegramMenu.ExpiryDays, now)
	if kind == "traffic" || kind == "yesterday" || telegramTrafficDateKind(kind) {
		view, err = telegramTrafficView(ctx, rows, kind, page, now)
	}
	view.Markup = telegramFilterKeyboard(view.Markup, n.TelegramMenu)
	return view, err
}
