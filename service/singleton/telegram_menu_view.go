package singleton

import (
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/nezhahq/nezha/model"
)

type telegramButton struct {
	Text string `json:"text"`
	Data string `json:"callback_data"`
}
type telegramKeyboard struct {
	Rows [][]telegramButton `json:"inline_keyboard"`
}
type telegramMenuView struct {
	Text   string           `json:"text"`
	Markup telegramKeyboard `json:"reply_markup"`
}
type telegramServerRow struct {
	ID                uint64
	Name              string
	UUID              string
	Online            bool
	LastActive        time.Time
	Billing           model.ServerBilling
	TotalIn, TotalOut uint64
	HasCounters       bool
}

const telegramPageSize = 15

func telegramSafeName(name string) string {
	name = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || (r >= 0x202a && r <= 0x202e) || (r >= 0x2066 && r <= 0x2069) {
			return ' '
		}
		return r
	}, name)
	runes := []rune(strings.TrimSpace(name))
	if len(runes) > 70 {
		return string(runes[:70]) + "…"
	}
	return string(runes)
}

func telegramServerRows(owner uint64, now time.Time) ([]telegramServerRow, error) {
	if DB == nil || ServerShared == nil || ServerIDReassignmentInProgress.Load() {
		return nil, errors.New("服务器信息正在更新，请稍后重试")
	}
	var user model.User
	if err := DB.Select("id", "role").First(&user, owner).Error; err != nil {
		return nil, errors.New("账号不可用")
	}
	if user.Role != model.RoleAdmin && user.Role != model.RoleMember {
		return nil, errors.New("账号不可用")
	}
	ServerShared.lockLifecycleRead()
	defer ServerShared.unlockLifecycleRead()
	rows := make([]telegramServerRow, 0)
	for _, s := range ServerShared.GetSortedList() {
		if s == nil || (user.Role != model.RoleAdmin && s.GetUserID() != user.ID) {
			continue
		}
		runtime := s.RuntimeSnapshot()
		var totalIn, totalOut uint64
		if runtime.State != nil {
			totalIn, totalOut = runtime.State.NetInTransfer, runtime.State.NetOutTransfer
		}
		rows = append(rows, telegramServerRow{
			ID: s.ID, UUID: s.UUID, Name: telegramSafeName(s.Name), LastActive: runtime.LastActive,
			Online:  !runtime.LastActive.IsZero() && now.Sub(runtime.LastActive) <= 30*time.Second,
			Billing: model.ParseServerBilling(s.PublicNote, now),
			TotalIn: totalIn, TotalOut: totalOut, HasCounters: runtime.State != nil && !runtime.LastActive.IsZero(),
		})
	}
	return rows, nil
}

func telegramCategoryButtons() [][]telegramButton {
	return [][]telegramButton{
		{{Text: "🟢 在线服务器", Data: "nzsm:online:0"}, {Text: "🔴 离线服务器", Data: "nzsm:offline:0"}},
		{{Text: "⏳ 即将到期服务器", Data: "nzsm:expiry:0"}, {Text: "📊 今日流量统计", Data: "nzsm:traffic:0"}},
	}
}
func telegramRender(rows []telegramServerRow, kind string, page, days int, now time.Time) telegramMenuView {
	markup := telegramKeyboard{Rows: telegramCategoryButtons()}
	stamp := now.In(model.PlanTrafficZone).Format("2006-01-02 15:04:05") + "（北京时间）"
	var online, offline, expiry int
	selected := make([]telegramServerRow, 0)
	for _, row := range rows {
		soon := row.Billing.ExpiresAt > now.Unix() && row.Billing.ExpiresAt <= now.Add(time.Duration(days)*24*time.Hour).Unix()
		if row.Online {
			online++
		} else {
			offline++
		}
		if soon {
			expiry++
		}
		if (kind == "online" && row.Online) || (kind == "offline" && !row.Online) || (kind == "expiry" && soon) {
			selected = append(selected, row)
		}
	}
	if kind == "home" {
		return telegramMenuView{Text: fmt.Sprintf("🖥 服务器概览\n在线 %d 台 · 离线 %d 台\n未来 %d 天到期 %d 台\n\n请选择下面的分类。\n%s", online, offline, days, expiry, stamp), Markup: markup}
	}
	title := map[string]string{"online": "🟢 在线服务器", "offline": "🔴 离线服务器", "expiry": "⏳ 即将到期服务器"}[kind]
	if kind == "expiry" {
		slices.SortStableFunc(selected, func(a, b telegramServerRow) int {
			if a.Billing.ExpiresAt < b.Billing.ExpiresAt {
				return -1
			}
			if a.Billing.ExpiresAt > b.Billing.ExpiresAt {
				return 1
			}
			return 0
		})
	}
	pages := max(1, (len(selected)+telegramPageSize-1)/telegramPageSize)
	page = max(0, min(page, pages-1))
	var text strings.Builder
	fmt.Fprintf(&text, "%s\n共 %d 台 · 第 %d / %d 页\n", title, len(selected), page+1, pages)
	if kind == "expiry" {
		fmt.Fprintf(&text, "范围：未来 %d 天，不含已到期及未设置日期\n", days)
	}
	if len(selected) == 0 {
		text.WriteString("\n暂无符合条件的服务器。\n")
	}
	for _, row := range selected[page*telegramPageSize : min(len(selected), (page+1)*telegramPageSize)] {
		fmt.Fprintf(&text, "\n%s（ID %d）\n", row.Name, row.ID)
		if kind == "expiry" {
			fmt.Fprintf(&text, "到期：%s · 剩余 %d 天\n", time.Unix(row.Billing.ExpiresAt, 0).In(model.PlanTrafficZone).Format("01-02 15:04"), row.Billing.RemainingDays)
			if row.Billing.RenewalProjected {
				text.WriteString("按自动续费周期推算，非付款确认\n")
			}
		} else if kind == "offline" {
			if row.LastActive.IsZero() {
				text.WriteString("暂无上报记录\n")
			} else {
				fmt.Fprintf(&text, "最后上报：%s\n", row.LastActive.In(model.PlanTrafficZone).Format("01-02 15:04"))
			}
		}
	}
	text.WriteString("\n" + stamp)
	nav := []telegramButton{}
	if page > 0 {
		nav = append(nav, telegramButton{Text: "上一页", Data: fmt.Sprintf("nzsm:%s:%d", kind, page-1)})
	}
	nav = append(nav, telegramButton{Text: "刷新", Data: fmt.Sprintf("nzsm:%s:%d", kind, page)})
	if page+1 < pages {
		nav = append(nav, telegramButton{Text: "下一页", Data: fmt.Sprintf("nzsm:%s:%d", kind, page+1)})
	}
	markup.Rows = append([][]telegramButton{nav}, markup.Rows...)
	markup.Rows = append(markup.Rows, []telegramButton{{Text: "返回服务器概览", Data: "nzsm:home:0"}})
	return telegramMenuView{Text: text.String(), Markup: markup}
}

func telegramParseCallback(data string) (string, int, bool) {
	parts := strings.Split(data, ":")
	if len(parts) != 3 || parts[0] != "nzsm" || len(parts[2]) > 6 {
		return "", 0, false
	}
	if !slices.Contains([]string{"home", "online", "offline", "expiry", "traffic", "yesterday"}, parts[1]) && !telegramTrafficDateKind(parts[1]) {
		return "", 0, false
	}
	page, err := strconv.Atoi(parts[2])
	return parts[1], page, err == nil && page >= 0 && page <= 100000
}
