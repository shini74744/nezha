package singleton

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/nezhahq/nezha/model"
)

type telegramAPIError struct {
	Code        int
	NotModified bool
	RetryAfter  int
}

func (e *telegramAPIError) Error() string { return fmt.Sprintf("Telegram 接口返回 %d", e.Code) }

type telegramAPI struct {
	client *http.Client
	target model.TelegramMenuTarget
}

func newTelegramAPI(target model.TelegramMenuTarget) *telegramAPI {
	return &telegramAPI{target: target, client: &http.Client{Timeout: 40 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}
func (api *telegramAPI) call(ctx context.Context, method string, payload any, result any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return errors.New("菜单请求无效")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.telegram.org/bot"+api.target.Token+"/"+method, bytes.NewReader(body))
	if err != nil {
		return errors.New("菜单请求无效")
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := api.client.Do(req)
	// net/http errors contain the URL (and bot token). Never return or log them.
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return errors.New("无法连接 Telegram，请检查网络后重试")
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return errors.New("Telegram 响应读取失败")
	}
	var envelope struct {
		OK          bool            `json:"ok"`
		Code        int             `json:"error_code"`
		Result      json.RawMessage `json:"result"`
		Description string          `json:"description"`
		Parameters  struct {
			RetryAfter int `json:"retry_after"`
		} `json:"parameters"`
	}
	if json.Unmarshal(raw, &envelope) != nil {
		return errors.New("Telegram 响应格式无效")
	}
	if !envelope.OK || resp.StatusCode != http.StatusOK {
		code := envelope.Code
		if code == 0 {
			code = resp.StatusCode
		}
		return &telegramAPIError{Code: code, NotModified: code == 400 && strings.Contains(envelope.Description, "message is not modified"), RetryAfter: envelope.Parameters.RetryAfter}
	}
	if result != nil && json.Unmarshal(envelope.Result, result) != nil {
		return errors.New("Telegram 响应数据无效")
	}
	return nil
}

type telegramUser struct {
	ID       int64  `json:"id"`
	IsBot    bool   `json:"is_bot"`
	Username string `json:"username"`
}
type telegramMessage struct {
	ID   int64         `json:"message_id"`
	Date int64         `json:"date"`
	Text string        `json:"text"`
	From *telegramUser `json:"from"`
	Chat struct {
		ID   int64  `json:"id"`
		Type string `json:"type"`
	} `json:"chat"`
}
type telegramCallback struct {
	ID      string           `json:"id"`
	From    telegramUser     `json:"from"`
	Message *telegramMessage `json:"message"`
	Data    string           `json:"data"`
}
type telegramUpdate struct {
	ID       int64             `json:"update_id"`
	Message  *telegramMessage  `json:"message"`
	Callback *telegramCallback `json:"callback_query"`
}

func (api *telegramAPI) register(ctx context.Context, configs ...*model.TelegramMenuConfig) (telegramUser, error) {
	var webhook struct {
		URL string `json:"url"`
	}
	if err := api.call(ctx, "getWebhookInfo", struct{}{}, &webhook); err != nil {
		return telegramUser{}, err
	}
	if webhook.URL != "" {
		return telegramUser{}, errors.New("机器人已有 Webhook，菜单已暂停；不会覆盖已有接收程序")
	}
	var me telegramUser
	if err := api.call(ctx, "getMe", struct{}{}, &me); err != nil {
		return me, err
	}
	if !me.IsBot || me.ID <= 0 {
		return me, errors.New("机器人身份无效")
	}
	scope := map[string]any{"type": "chat", "chat_id": api.target.ChatID}
	commands := telegramCommandList(configs...)
	// Scoped to this private recipient, never rewrite global or group menus.
	for _, language := range []string{"", "zh", "en"} {
		if err := api.call(ctx, "setMyCommands", map[string]any{"scope": scope, "language_code": language, "commands": commands}, nil); err != nil {
			return me, err
		}
	}
	return me, api.call(ctx, "setChatMenuButton", map[string]any{"chat_id": api.target.ChatID, "menu_button": map[string]string{"type": "commands"}}, nil)
}
func (api *telegramAPI) clear(ctx context.Context) {
	scope := map[string]any{"type": "chat", "chat_id": api.target.ChatID}
	for _, language := range []string{"", "zh", "en"} {
		_ = api.call(ctx, "deleteMyCommands", map[string]any{"scope": scope, "language_code": language}, nil)
	}
	_ = api.call(ctx, "setChatMenuButton", map[string]any{"chat_id": api.target.ChatID, "menu_button": map[string]string{"type": "default"}}, nil)
}
func telegramAuthorized(update telegramUpdate, target model.TelegramMenuTarget, botID int64, now time.Time) bool {
	if q := update.Callback; q != nil {
		return q.From.ID == target.ChatID && !q.From.IsBot && q.Message != nil && q.Message.Chat.Type == "private" && q.Message.Chat.ID == target.ChatID && q.Message.From != nil && q.Message.From.ID == botID && q.Message.From.IsBot && q.Message.ID > 0
	}
	m := update.Message
	return m != nil && m.From != nil && !m.From.IsBot && m.From.ID == target.ChatID && m.Chat.ID == target.ChatID && m.Chat.Type == "private" && m.Date > 0 && now.Unix()-m.Date <= 300 && m.Date <= now.Add(time.Minute).Unix()
}
