package singleton

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/nezhahq/nezha/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type TelegramMenuStatus struct {
	State     string `json:"state"`
	Message   string `json:"message"`
	UpdatedAt int64  `json:"updated_at"`
}

var telegramMenus = struct {
	sync.Mutex
	cancel   context.CancelFunc
	done     chan struct{}
	statuses map[uint64]TelegramMenuStatus
}{statuses: make(map[uint64]TelegramMenuStatus)}

func setTelegramMenuStatus(id uint64, state, message string) {
	telegramMenus.Lock()
	defer telegramMenus.Unlock()
	previous := telegramMenus.statuses[id]
	telegramMenus.statuses[id] = TelegramMenuStatus{State: state, Message: message, UpdatedAt: time.Now().Unix()}
	if previous.State != state || previous.Message != message {
		log.Printf("NEZHA>> TelegramMenu::notification=%d state=%s %s", id, state, message)
	}
}
func GetTelegramMenuStatus(n *model.Notification) TelegramMenuStatus {
	if n.TelegramMenu == nil || !n.TelegramMenu.Enabled {
		return TelegramMenuStatus{State: "disabled", Message: "已关闭"}
	}
	telegramMenus.Lock()
	defer telegramMenus.Unlock()
	if s, ok := telegramMenus.statuses[n.ID]; ok {
		return s
	}
	return TelegramMenuStatus{State: "starting", Message: "等待连接 Telegram"}
}
func telegramMenuBinding(n *model.Notification) string {
	raw, _ := json.Marshal([]any{n.ID, n.UserID, n.URL, n.RequestMethod, n.RequestType, n.RequestBody, n.TelegramMenu})
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// Caller serializes notification saves. Duplicate bot consumers are also
// rejected by the runtime reconciler if settings were changed outside the API.
func ValidateTelegramMenuConfiguration(n *model.Notification) error {
	if err := n.ValidateTelegramMenu(); err != nil {
		return err
	}
	if n.TelegramMenu == nil || !n.TelegramMenu.Enabled {
		return nil
	}
	target, _ := n.TelegramMenuTarget()
	var list []model.Notification
	if err := DB.Select("id", "url", "request_method", "request_type", "request_body", "telegram_menu").Find(&list).Error; err != nil {
		return errors.New("无法核对机器人菜单配置")
	}
	for _, other := range list {
		if other.ID == n.ID || other.TelegramMenu == nil || !other.TelegramMenu.Enabled {
			continue
		}
		peer, err := other.TelegramMenuTarget()
		if err == nil && peer.BotKey == target.BotKey {
			return errors.New("同一个机器人只能启用一份服务器管理菜单，请先关闭另一份")
		}
	}
	return nil
}
func StartTelegramMenus() {
	telegramMenus.Lock()
	if telegramMenus.cancel != nil {
		telegramMenus.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	telegramMenus.cancel, telegramMenus.done = cancel, done
	telegramMenus.Unlock()
	go func() { defer close(done); runTelegramMenus(ctx) }()
}
func StopTelegramMenus(ctx context.Context) error {
	telegramMenus.Lock()
	cancel, done := telegramMenus.cancel, telegramMenus.done
	telegramMenus.Unlock()
	if cancel == nil {
		return nil
	}
	cancel()
	select {
	case <-done:
		telegramMenus.Lock()
		telegramMenus.cancel = nil
		telegramMenus.done = nil
		telegramMenus.Unlock()
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

type telegramWorker struct {
	binding string
	target  model.TelegramMenuTarget
	cancel  context.CancelFunc
	done    chan struct{}
}

func runTelegramMenus(ctx context.Context) {
	workers := map[uint64]*telegramWorker{}
	reportsDone := make(chan struct{})
	go func() { defer close(reportsDone); runTelegramReports(ctx) }()
	defer func() { <-reportsDone }()
	defer func() {
		for _, w := range workers {
			w.cancel()
		}
		for _, w := range workers {
			<-w.done
		}
	}()
	reconcile := func() {
		if NotificationShared == nil {
			return
		}
		desired := map[uint64]*model.Notification{}
		counts := map[string]int{}
		for _, n := range NotificationShared.GetSortedList() {
			if n.TelegramMenu == nil || !n.TelegramMenu.Enabled {
				continue
			}
			if err := n.ValidateTelegramMenu(); err != nil {
				setTelegramMenuStatus(n.ID, "blocked", err.Error())
				continue
			}
			target, _ := n.TelegramMenuTarget()
			counts[target.BotKey]++
			desired[n.ID] = n
		}
		for id, n := range desired {
			target, _ := n.TelegramMenuTarget()
			if counts[target.BotKey] > 1 {
				delete(desired, id)
				setTelegramMenuStatus(id, "blocked", "同一个机器人配置了多个菜单，已暂停")
			}
		}
		for id, w := range workers {
			n, exists := desired[id]
			if exists && w.binding == telegramMenuBinding(n) {
				continue
			}
			w.cancel()
			<-w.done
			delete(workers, id)
			if ctx.Err() == nil {
				cleanup, cancel := context.WithTimeout(ctx, 8*time.Second)
				newTelegramAPI(w.target).clear(cleanup)
				cancel()
			}
		}
		for id, n := range desired {
			if ctx.Err() != nil {
				return
			}
			if _, exists := workers[id]; exists {
				continue
			}
			target, _ := n.TelegramMenuTarget()
			child, cancel := context.WithCancel(ctx)
			w := &telegramWorker{binding: telegramMenuBinding(n), target: target, cancel: cancel, done: make(chan struct{})}
			workers[id] = w
			setTelegramMenuStatus(id, "starting", "正在连接 Telegram 并同步菜单")
			go func(n *model.Notification, w *telegramWorker) {
				defer close(w.done)
				runTelegramWorker(child, n, w, newTelegramAPI(w.target))
			}(n, w)
		}
	}
	reconcile()
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			reconcile()
		}
	}
}
func telegramWait(ctx context.Context, d time.Duration) bool {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
func telegramBindingCurrent(n *model.Notification, binding string) bool {
	var current model.Notification
	return DB.First(&current, n.ID).Error == nil && current.TelegramMenu != nil && current.TelegramMenu.Enabled && telegramMenuBinding(&current) == binding
}
func telegramSaveOffset(key string, next int64) error {
	cursor := model.TelegramMenuCursor{BotKey: key, NextUpdate: next}
	return DB.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "bot_key"}}, DoUpdates: clause.Assignments(map[string]any{"next_update": gorm.Expr("MAX(next_update, ?)", next)})}).Create(&cursor).Error
}
func runTelegramWorker(ctx context.Context, n *model.Notification, w *telegramWorker, api *telegramAPI) {
	var me telegramUser
	for ctx.Err() == nil {
		var err error
		me, err = api.register(ctx, n.TelegramMenu)
		if err == nil {
			break
		}
		setTelegramMenuStatus(n.ID, "error", err.Error())
		if !telegramWait(ctx, 30*time.Second) {
			return
		}
	}
	if ctx.Err() != nil {
		return
	}
	var cursor model.TelegramMenuCursor
	if err := DB.Where("bot_key = ?", w.target.BotKey).FirstOrCreate(&cursor, model.TelegramMenuCursor{BotKey: w.target.BotKey}).Error; err != nil {
		setTelegramMenuStatus(n.ID, "error", "菜单进度保存失败，请检查数据库")
		return
	}
	offset := cursor.NextUpdate
	var last, window time.Time
	count := 0
	backoff := 5 * time.Second
	for ctx.Err() == nil {
		setTelegramMenuStatus(n.ID, "ready", "已连接：左侧菜单可直接选择服务器分类")
		var updates []telegramUpdate
		err := api.call(ctx, "getUpdates", map[string]any{"offset": offset, "timeout": 25, "limit": 30, "allowed_updates": []string{"message", "callback_query"}}, &updates)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			var e *telegramAPIError
			if errors.As(err, &e) && (e.Code == 409 || e.Code == 401 || e.Code == 403) {
				setTelegramMenuStatus(n.ID, "blocked", "机器人授权失效或已有其他接收程序，已暂停；修正后关闭再开启菜单")
				return
			}
			setTelegramMenuStatus(n.ID, "error", err.Error())
			wait := backoff
			if errors.As(err, &e) && e.RetryAfter > 0 {
				wait = time.Duration(min(300, e.RetryAfter)) * time.Second
			}
			if !telegramWait(ctx, wait) {
				return
			}
			backoff = min(time.Minute, backoff*2)
			continue
		}
		backoff = 5 * time.Second
		for _, update := range updates {
			if ctx.Err() != nil {
				return
			}
			if update.ID < offset || update.ID < 0 || update.ID >= 1<<52 {
				continue
			}
			// Persist before executing a read-only query: a restart cannot replay replies.
			if err = telegramSaveOffset(w.target.BotKey, update.ID+1); err != nil {
				setTelegramMenuStatus(n.ID, "error", "菜单进度保存失败，已暂停")
				return
			}
			offset = update.ID + 1
			now := time.Now()
			if !telegramAuthorized(update, w.target, me.ID, now) || !telegramBindingCurrent(n, w.binding) {
				continue
			}
			kind, page := "home", 0
			if update.Callback != nil {
				var ok bool
				kind, page, ok = telegramParseCallback(update.Callback.Data)
				if !ok {
					continue
				}
			} else {
				var ok bool
				kind, ok = telegramParseCommand(update.Message.Text, me.Username)
				if !ok {
					continue
				}
			}
			if now.Sub(window) >= time.Minute {
				window = now
				count = 0
			}
			if now.Sub(last) < time.Second || count >= 20 {
				if update.Callback != nil {
					_ = api.call(ctx, "answerCallbackQuery", map[string]any{"callback_query_id": update.Callback.ID, "text": "操作太快，请稍后重试"}, nil)
				}
				continue
			}
			last = now
			count++
			if update.Callback != nil {
				_ = api.call(ctx, "answerCallbackQuery", map[string]any{"callback_query_id": update.Callback.ID}, nil)
			}
			view, err := telegramConfiguredView(ctx, n, kind, page, now)
			if err != nil {
				setTelegramMenuStatus(n.ID, "error", "服务器信息暂时不可用")
				view = telegramMenuView{Text: "服务器信息暂时不可用，请稍后重试。", Markup: telegramKeyboard{Rows: telegramCategoryButtons()}}
			}
			if !telegramBindingCurrent(n, w.binding) {
				continue
			}
			view.Markup = telegramFilterKeyboard(view.Markup, n.TelegramMenu)
			method := "sendMessage"
			payload := map[string]any{"chat_id": w.target.ChatID, "text": view.Text, "reply_markup": view.Markup, "link_preview_options": map[string]bool{"is_disabled": true}}
			if update.Callback != nil {
				method = "editMessageText"
				payload["message_id"] = update.Callback.Message.ID
			}
			if err = api.call(ctx, method, payload, nil); err != nil {
				var e *telegramAPIError
				if !errors.As(err, &e) || !e.NotModified {
					setTelegramMenuStatus(n.ID, "error", fmt.Sprintf("查询结果发送失败：%v", err))
				}
			}
		}
	}
}
