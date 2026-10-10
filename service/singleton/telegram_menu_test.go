package singleton

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
	"unicode/utf16"

	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
)

type telegramRoundTrip func(*http.Request) (*http.Response, error)

func (f telegramRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func telegramTestResponse(data any) *http.Response {
	raw, _ := json.Marshal(map[string]any{"ok": true, "result": data})
	return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(raw))), Header: make(http.Header)}
}
func telegramSetup(t *testing.T) *model.Notification {
	setupCleanMonitorHistoryTestDB(t)
	require.NoError(t, DB.AutoMigrate(&model.User{}, &model.Notification{}, &model.TelegramMenuCursor{}, &model.TelegramDailyDelivery{}, &model.PlanTrafficDay{}, &model.PlanTrafficCheckpoint{}))
	old := ServerShared
	ServerShared = NewEmptyServerClassForTest()
	t.Cleanup(func() { ServerShared = old })
	for _, user := range []model.User{{Common: model.Common{ID: 10}, Username: "owner", Role: model.RoleMember}, {Common: model.Common{ID: 1}, Username: "admin", Role: model.RoleAdmin}} {
		require.NoError(t, DB.Create(&user).Error)
	}
	ServerShared.InsertForTest(&model.Server{Common: model.Common{ID: 11, UserID: 10}, Name: "own", LastActive: time.Now()})
	ServerShared.InsertForTest(&model.Server{Common: model.Common{ID: 12, UserID: 999}, Name: "foreign-secret", LastActive: time.Now()})
	n := &model.Notification{Common: model.Common{ID: 7, UserID: 10}, Name: "menu", URL: "https://api.telegram.org/bot123:fixture_token/sendMessage", RequestMethod: 2, RequestType: 1, RequestBody: `{"chat_id":12345678,"text":"#NEZHA#"}`, TelegramMenu: &model.TelegramMenuConfig{Enabled: true, ExpiryDays: 7}}
	require.NoError(t, DB.Create(n).Error)
	return n
}
func TestTelegramMenuQueryOwnershipAndFreshRole(t *testing.T) {
	telegramSetup(t)
	rows, err := telegramServerRows(10, time.Now())
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.Equal(t, "own", rows[0].Name)
	require.True(t, rows[0].Online)
	rows, err = telegramServerRows(1, time.Now())
	require.NoError(t, err)
	require.Len(t, rows, 2)
	require.NoError(t, DB.Model(&model.User{}).Where("id = ?", 1).UpdateColumn("role", model.RoleMember).Error)
	rows, err = telegramServerRows(1, time.Now())
	require.NoError(t, err)
	require.Empty(t, rows)
	require.NoError(t, DB.Delete(&model.User{}, 10).Error)
	_, err = telegramServerRows(10, time.Now())
	require.Error(t, err)
}
func TestTelegramMenuPageExpiryAndLength(t *testing.T) {
	now := trafficTime("2026-10-10T18:00:00+08:00")
	rows := []telegramServerRow{}
	for i := 1; i <= 119; i++ {
		rows = append(rows, telegramServerRow{ID: uint64(i), Name: telegramSafeName(strings.Repeat("😀", 200) + "\n"), Online: i <= 116})
	}
	view := telegramRender(rows, "online", 0, 7, now)
	require.Contains(t, view.Text, "共 116 台 · 第 1 / 8 页")
	require.Contains(t, view.Text, "ID 15")
	require.NotContains(t, view.Text, "ID 16")
	require.Less(t, len(utf16.Encode([]rune(view.Text))), 4096)
	view = telegramRender(rows, "online", 99999, 7, now)
	require.Contains(t, view.Text, "第 8 / 8 页")
	require.Contains(t, view.Text, "ID 116")
	view = telegramRender(rows, "offline", 0, 7, now)
	require.Contains(t, view.Text, "共 3 台")
	require.Contains(t, view.Text, "暂无上报记录")
	rows = []telegramServerRow{
		{ID: 1, Name: "boundary", Billing: model.ServerBilling{ExpiresAt: now.Add(7 * 24 * time.Hour).Unix(), RemainingDays: 7}},
		{ID: 2, Name: "expired", Billing: model.ServerBilling{ExpiresAt: now.Unix()}},
		{ID: 3, Name: "later", Billing: model.ServerBilling{ExpiresAt: now.Add(8 * 24 * time.Hour).Unix()}},
		{ID: 4, Name: "unset"},
		{ID: 5, Name: "near", Billing: model.ServerBilling{ExpiresAt: now.Add(time.Hour).Unix(), RemainingDays: 1, RenewalProjected: true}},
	}
	view = telegramRender(rows, "expiry", 0, 7, now)
	require.Contains(t, view.Text, "共 2 台")
	require.NotContains(t, view.Text, "expired")
	require.NotContains(t, view.Text, "later")
	require.NotContains(t, view.Text, "unset")
	require.Less(t, strings.Index(view.Text, "near"), strings.Index(view.Text, "boundary"))
	require.Contains(t, view.Text, "非付款确认")
	for _, raw := range []string{"nzsm:online:-1", "nzsm:run:0", "nzsm:online:9999999", "bad", "nzsm:online:0:extra"} {
		_, _, ok := telegramParseCallback(raw)
		require.False(t, ok)
	}
	_, page, ok := telegramParseCallback("nzsm:offline:2")
	require.True(t, ok)
	require.Equal(t, 2, page)
}
func telegramTestMessage(id int64, text string) *telegramMessage {
	m := &telegramMessage{ID: 88, Date: time.Now().Unix(), Text: text, From: &telegramUser{ID: id}}
	m.Chat.ID = id
	m.Chat.Type = "private"
	return m
}
func TestTelegramMenuUpdateAuthorization(t *testing.T) {
	target := model.TelegramMenuTarget{ChatID: 12345678}
	m := telegramTestMessage(target.ChatID, "/servers")
	require.True(t, telegramAuthorized(telegramUpdate{Message: m}, target, 123, time.Now()))
	m.Chat.Type = "group"
	require.False(t, telegramAuthorized(telegramUpdate{Message: m}, target, 123, time.Now()))
	m.Chat.Type = "private"
	m.From.ID = 999
	require.False(t, telegramAuthorized(telegramUpdate{Message: m}, target, 123, time.Now()))
	m = telegramTestMessage(target.ChatID, "/servers")
	m.Date -= 301
	require.False(t, telegramAuthorized(telegramUpdate{Message: m}, target, 123, time.Now()))
	m = telegramTestMessage(target.ChatID, "result")
	m.From = &telegramUser{ID: 123, IsBot: true}
	q := &telegramCallback{ID: "q", From: telegramUser{ID: target.ChatID}, Message: m, Data: "nzsm:online:0"}
	require.True(t, telegramAuthorized(telegramUpdate{Callback: q}, target, 123, time.Now()))
	q.From.ID = 999
	require.False(t, telegramAuthorized(telegramUpdate{Callback: q}, target, 123, time.Now()))
	q.From.ID = target.ChatID
	m.From.ID = 321
	require.False(t, telegramAuthorized(telegramUpdate{Callback: q}, target, 123, time.Now()))
}
func TestTelegramMenuWorkerOffsetDisableAndNoForeignReplies(t *testing.T) {
	for _, command := range telegramMenuCommands {
		for _, disabled := range []bool{false, true} {
			t.Run(command.Command+fmt.Sprint(disabled), func(t *testing.T) {
				n := telegramSetup(t)
				target, err := n.TelegramMenuTarget()
				require.NoError(t, err)
				ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
				defer cancel()
				api := newTelegramAPI(target)
				replies, polls := 0, 0
				api.client.Transport = telegramRoundTrip(func(r *http.Request) (*http.Response, error) {
					method := r.URL.Path[strings.LastIndex(r.URL.Path, "/")+1:]
					var body map[string]any
					require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
					switch method {
					case "getWebhookInfo":
						return telegramTestResponse(map[string]string{"url": ""}), nil
					case "getMe":
						return telegramTestResponse(telegramUser{ID: 123, IsBot: true, Username: "fixturebot"}), nil
					case "setMyCommands":
						require.Equal(t, float64(target.ChatID), body["scope"].(map[string]any)["chat_id"])
						require.Equal(t, "chat", body["scope"].(map[string]any)["type"])
						got, _ := json.Marshal(body["commands"])
						want, _ := json.Marshal(telegramCommandList())
						require.JSONEq(t, string(want), string(got))
						return telegramTestResponse(true), nil
					case "setChatMenuButton":
						return telegramTestResponse(true), nil
					case "getUpdates":
						polls++
						if polls > 1 {
							require.Equal(t, float64(3), body["offset"])
							cancel()
							return nil, ctx.Err()
						}
						if disabled {
							require.NoError(t, DB.Model(&model.Notification{}).Where("id = ?", n.ID).UpdateColumn("telegram_menu", `{"enabled":false,"expiry_days":7}`).Error)
						}
						return telegramTestResponse([]telegramUpdate{{ID: 1, Message: telegramTestMessage(999, "/"+command.Command)}, {ID: 2, Message: telegramTestMessage(target.ChatID, "/"+command.Command)}}), nil
					case "sendMessage":
						replies++
						require.Equal(t, float64(target.ChatID), body["chat_id"])
						require.Contains(t, body["text"], command.Description)
						if command.Category != "home" {
							require.NotContains(t, body["text"], "请选择下面的分类")
						}
						require.NotContains(t, body["text"], "foreign-secret")
						return telegramTestResponse(map[string]int{"message_id": 1}), nil
					default:
						t.Fatalf("unexpected method %s", method)
						return nil, errors.New("unexpected")
					}
				})
				w := &telegramWorker{binding: telegramMenuBinding(n), target: target}
				runTelegramWorker(ctx, n, w, api)
				if disabled {
					require.Zero(t, replies)
				} else {
					require.Equal(t, 1, replies)
				}
				var cursor model.TelegramMenuCursor
				require.NoError(t, DB.First(&cursor).Error)
				require.Equal(t, int64(3), cursor.NextUpdate)
				require.NoError(t, telegramSaveOffset(target.BotKey, 2))
				require.NoError(t, DB.First(&cursor).Error)
				require.Equal(t, int64(3), cursor.NextUpdate)
			})
		}
	}
}
func TestTelegramMenuAPIConflictWebhookAndSecretRedaction(t *testing.T) {
	api := newTelegramAPI(model.TelegramMenuTarget{Token: "123:fixture_token", ChatID: 12345678})
	api.client.Transport = telegramRoundTrip(func(r *http.Request) (*http.Response, error) {
		require.True(t, strings.HasSuffix(r.URL.Path, "/getWebhookInfo"))
		return telegramTestResponse(map[string]string{"url": "https://existing.example/webhook"}), nil
	})
	_, err := api.register(context.Background())
	require.ErrorContains(t, err, "不会覆盖")
	api.client.Transport = telegramRoundTrip(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("https://api.telegram.org/bot123:fixture_token/sendMessage")
	})
	err = api.call(context.Background(), "sendMessage", map[string]string{}, nil)
	require.Error(t, err)
	require.NotContains(t, err.Error(), "fixture_token")
	api.client.Transport = telegramRoundTrip(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 409, Body: io.NopCloser(strings.NewReader(`{"ok":false,"error_code":409,"description":"fixture_token"}`))}, nil
	})
	err = api.call(context.Background(), "getUpdates", struct{}{}, nil)
	var typed *telegramAPIError
	require.ErrorAs(t, err, &typed)
	require.Equal(t, 409, typed.Code)
	require.NotContains(t, err.Error(), "fixture_token")
}

func TestTelegramMenuCallbackWorkerAndThrottling(t *testing.T) {
	n := telegramSetup(t)
	target, err := n.TelegramMenuTarget()
	require.NoError(t, err)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	api := newTelegramAPI(target)
	polls, edits, acks := 0, 0, 0
	message := telegramTestMessage(target.ChatID, "prior result")
	message.From = &telegramUser{ID: 123, IsBot: true}
	api.client.Transport = telegramRoundTrip(func(r *http.Request) (*http.Response, error) {
		method := r.URL.Path[strings.LastIndex(r.URL.Path, "/")+1:]
		var body map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		switch method {
		case "getWebhookInfo":
			return telegramTestResponse(map[string]string{"url": ""}), nil
		case "getMe":
			return telegramTestResponse(telegramUser{ID: 123, IsBot: true, Username: "fixturebot"}), nil
		case "setMyCommands", "setChatMenuButton":
			return telegramTestResponse(true), nil
		case "getUpdates":
			polls++
			if polls > 1 {
				require.Equal(t, float64(5), body["offset"])
				cancel()
				return nil, ctx.Err()
			}
			return telegramTestResponse([]telegramUpdate{
				{ID: 1, Callback: &telegramCallback{ID: "foreign", From: telegramUser{ID: 999}, Message: message, Data: "nzsm:online:0"}},
				{ID: 2, Callback: &telegramCallback{ID: "valid", From: telegramUser{ID: target.ChatID}, Message: message, Data: "nzsm:online:0"}},
				{ID: 3, Callback: &telegramCallback{ID: "quick", From: telegramUser{ID: target.ChatID}, Message: message, Data: "nzsm:offline:0"}},
				{ID: 4, Callback: &telegramCallback{ID: "malformed", From: telegramUser{ID: target.ChatID}, Message: message, Data: "nzsm:exec:0"}},
			}), nil
		case "answerCallbackQuery":
			acks++
			require.Contains(t, []string{"valid", "quick"}, body["callback_query_id"])
			if body["callback_query_id"] == "quick" {
				require.Contains(t, body["text"], "操作太快")
			}
			return telegramTestResponse(true), nil
		case "editMessageText":
			edits++
			require.Equal(t, float64(message.ID), body["message_id"])
			require.Equal(t, float64(target.ChatID), body["chat_id"])
			require.Contains(t, body["text"], "own")
			require.NotContains(t, body["text"], "foreign-secret")
			require.NotContains(t, body, "parse_mode")
			return telegramTestResponse(true), nil
		default:
			t.Fatalf("unexpected %s", method)
			return nil, errors.New("unexpected")
		}
	})
	runTelegramWorker(ctx, n, &telegramWorker{binding: telegramMenuBinding(n), target: target}, api)
	require.Equal(t, 1, edits)
	require.Equal(t, 2, acks)
}

func TestTelegramMenuShutdownIsBoundedAndIdempotent(t *testing.T) {
	old := NotificationShared
	NotificationShared = NewEmptyNotificationClassForTest()
	t.Cleanup(func() { NotificationShared = old })
	StartTelegramMenus()
	StartTelegramMenus()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	require.NoError(t, StopTelegramMenus(ctx))
	require.NoError(t, StopTelegramMenus(ctx))
}
