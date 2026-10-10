package singleton

import (
	"github.com/nezhahq/nezha/model"
	"strings"
)

type telegramMenuCommand struct {
	Command     string
	Description string
	Category    string
}

var telegramMenuCommands = [...]telegramMenuCommand{
	{Command: "servers", Description: "🖥 服务器概览", Category: "home"},
	{Command: "online", Description: "🟢 在线服务器", Category: "online"},
	{Command: "offline", Description: "🔴 离线服务器", Category: "offline"},
	{Command: "expiring", Description: "⏳ 即将到期服务器", Category: "expiry"},
	{Command: "traffic", Description: "📊 今日流量统计", Category: "traffic"},
}

func telegramCommandList(configs ...*model.TelegramMenuConfig) []map[string]string {
	var config *model.TelegramMenuConfig
	if len(configs) > 0 {
		config = configs[0]
	}
	commands := make([]map[string]string, 0, len(telegramMenuCommands))
	for _, entry := range telegramMenuCommands {
		if !config.ItemEnabled(entry.Category) {
			continue
		}
		commands = append(commands, map[string]string{"command": entry.Command, "description": entry.Description})
	}
	return commands
}

func telegramParseCommand(text, username string) (string, bool) {
	parts := strings.Fields(text)
	if len(parts) == 0 || !strings.HasPrefix(parts[0], "/") {
		return "", false
	}
	command, addressedTo, hasAddress := strings.Cut(strings.ToLower(parts[0][1:]), "@")
	if hasAddress && (username == "" || !strings.EqualFold(addressedTo, username)) {
		return "", false
	}
	// Retain the existing Start/overview entry point.
	if command == "start" {
		return "home", true
	}
	for _, entry := range telegramMenuCommands {
		if command == entry.Command {
			return entry.Category, true
		}
	}
	return "", false
}
