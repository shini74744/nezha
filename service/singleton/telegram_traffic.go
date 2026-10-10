package singleton

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/nezhahq/nezha/model"
	"gorm.io/gorm"
)

type telegramTrafficRow struct {
	telegramServerRow
	In, Out            uint64
	Partial, Estimated bool
	Unavailable        bool
}
type telegramTrafficSummary struct {
	Rows                         []telegramTrafficRow
	In, Out                      float64
	Partial, Estimated           int
	Day                          string
	TotalIn, TotalOut            float64
	CountersMissing, Unavailable int
}

func telegramTrafficQuery(ctx context.Context, rows []telegramServerRow, day time.Time, now time.Time) (telegramTrafficSummary, error) {
	day = day.In(model.PlanTrafficZone)
	from := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, model.PlanTrafficZone)
	cutoff := min(now.UnixMilli(), from.AddDate(0, 0, 1).UnixMilli()) - int64(2*time.Minute/time.Millisecond)
	sum := telegramTrafficSummary{Day: from.Format("2006-01-02")}
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		if row.UUID != "" {
			ids = append(ids, row.UUID)
		}
	}
	var days []model.PlanTrafficDay
	var checkpoints []model.PlanTrafficCheckpoint
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if len(ids) > 0 {
		if err := DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if err := tx.Where("uuid IN ? AND day = ?", ids, sum.Day).Find(&days).Error; err != nil {
				return err
			}
			return tx.Where("uuid IN ?", ids).Find(&checkpoints).Error
		}); err != nil {
			return sum, err
		}
	}
	byDay := map[string]model.PlanTrafficDay{}
	byCheckpoint := map[string]model.PlanTrafficCheckpoint{}
	for _, v := range days {
		byDay[v.UUID] = v
	}
	for _, v := range checkpoints {
		byCheckpoint[v.UUID] = v
	}
	for _, row := range rows {
		d, c := byDay[row.UUID], byCheckpoint[row.UUID]
		item := telegramTrafficRow{telegramServerRow: row, In: d.In, Out: d.Out, Estimated: d.Estimated,
			Partial:     d.Partial || d.Unreliable || c.CoveredFrom == 0 || c.CoveredFrom > from.UnixMilli() || c.At < cutoff,
			Unavailable: d.Unreliable || c.At == 0}
		if item.Unavailable {
			item.In, item.Out = 0, 0
			sum.Unavailable++
		}
		sum.In += float64(item.In)
		sum.Out += float64(item.Out)
		if row.HasCounters {
			sum.TotalIn += float64(row.TotalIn)
			sum.TotalOut += float64(row.TotalOut)
		} else {
			sum.CountersMissing++
		}
		if item.Partial {
			sum.Partial++
		}
		if item.Estimated {
			sum.Estimated++
		}
		sum.Rows = append(sum.Rows, item)
	}
	return sum, nil
}
func telegramBytes(n float64) string {
	units := []string{"B", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB"}
	i := 0
	for n >= 1024 && i < len(units)-1 {
		n /= 1024
		i++
	}
	if i == 0 {
		return fmt.Sprintf("%.0f B", n)
	}
	return fmt.Sprintf("%.2f %s", n, units[i])
}
func telegramTrafficHeader(sum telegramTrafficSummary, title string) string {
	label := "当日总用量"
	if title == "📊 今日流量统计" {
		label = "今日总用量（00:00 至当前）"
	}
	usage := fmt.Sprintf("↑ 上传：%s\n↓ 下载：%s\n↕ 双向合计：%s", telegramBytes(sum.Out), telegramBytes(sum.In), telegramBytes(sum.Out+sum.In))
	if len(sum.Rows) > 0 && sum.Unavailable == len(sum.Rows) {
		usage = "暂无可核实用量"
	} else if sum.Partial > 0 || sum.Estimated > 0 {
		usage += "（已记录 ≈）"
	}
	counters := fmt.Sprintf("↑ 上传：%s · ↓ 下载：%s\n↕ 累计合计：%s", telegramBytes(sum.TotalOut), telegramBytes(sum.TotalIn), telegramBytes(sum.TotalOut+sum.TotalIn))
	if sum.CountersMissing == len(sum.Rows) {
		counters = "暂无累计计数器上报"
	}
	return fmt.Sprintf("%s\n%s（北京时间）\n共 %d 台 · 包含离线、无限流量及未设配额服务器\n\n📅 %s\n%s\n\n🖥 服务器累计总量（最新上报）\n%s\n", title, sum.Day, len(sum.Rows), label, usage, counters)
}
func telegramTrafficFooter(sum telegramTrafficSummary) string {
	return fmt.Sprintf("\n按已收到的上报统计：%d 台记录不完整，%d 台含估算，%d 台当日记录不可核实（未计入）。缺失不代表零用量。累计值是各机最新计数器之和，重启或重置可能变化；%d 台暂无累计上报。双向合计不改变套餐计费方向。", sum.Partial, sum.Estimated, sum.Unavailable, sum.CountersMissing)
}
func telegramTrafficView(ctx context.Context, rows []telegramServerRow, kind string, page int, now time.Time) (telegramMenuView, error) {
	date, title := now, "📊 今日流量统计"
	if kind == "yesterday" {
		date = now.In(model.PlanTrafficZone).AddDate(0, 0, -1)
		title = "📊 昨日流量统计"
	}
	if telegramTrafficDateKind(kind) {
		date, _ = time.ParseInLocation("2006-01-02", strings.TrimPrefix(kind, "day"), model.PlanTrafficZone)
		title = "📊 每日流量明细"
	}
	sum, err := telegramTrafficQuery(ctx, rows, date, now)
	if err != nil {
		return telegramMenuView{}, err
	}
	pages := max(1, (len(rows)+telegramPageSize-1)/telegramPageSize)
	page = max(0, min(page, pages-1))
	var text strings.Builder
	text.WriteString(telegramTrafficHeader(sum, title))
	fmt.Fprintf(&text, "\n第 %d / %d 页\n", page+1, pages)
	for _, row := range sum.Rows[page*telegramPageSize : min(len(rows), (page+1)*telegramPageSize)] {
		if row.Unavailable {
			fmt.Fprintf(&text, "\n%s（ID %d）\n当日记录暂不可核实\n", row.Name, row.ID)
			continue
		}
		suffix := ""
		if row.Partial || row.Estimated {
			suffix = " ≈"
		}
		fmt.Fprintf(&text, "\n%s（ID %d）%s\n↑ %s · ↓ %s\n", row.Name, row.ID, suffix, telegramBytes(float64(row.Out)), telegramBytes(float64(row.In)))
	}
	if len(rows) == 0 {
		text.WriteString("\n暂无可查看的服务器。\n")
	}
	text.WriteString(telegramTrafficFooter(sum))
	fmt.Fprintf(&text, "\n更新：%s", now.In(model.PlanTrafficZone).Format("01-02 15:04:05"))
	nav := []telegramButton{}
	if page > 0 {
		nav = append(nav, telegramButton{Text: "上一页", Data: fmt.Sprintf("nzsm:%s:%d", kind, page-1)})
	}
	nav = append(nav, telegramButton{Text: "刷新", Data: fmt.Sprintf("nzsm:%s:%d", kind, page)})
	if page+1 < pages {
		nav = append(nav, telegramButton{Text: "下一页", Data: fmt.Sprintf("nzsm:%s:%d", kind, page+1)})
	}
	return telegramMenuView{Text: text.String(), Markup: telegramKeyboard{Rows: [][]telegramButton{nav,
		{{Text: "今日流量", Data: "nzsm:traffic:0"}, {Text: "昨日流量", Data: "nzsm:yesterday:0"}},
		{{Text: "返回服务器概览", Data: "nzsm:home:0"}}}}}, nil
}
func telegramDailyText(sum telegramTrafficSummary) string {
	var text strings.Builder
	text.WriteString(telegramTrafficHeader(sum, "📊 每日流量用量"))
	text.WriteString("统计范围：上述日期全天（00:00–次日00:00）\n\n双向用量前 10 台：\n")
	rows := slices.DeleteFunc(slices.Clone(sum.Rows), func(row telegramTrafficRow) bool { return row.Unavailable })
	slices.SortStableFunc(rows, func(a, b telegramTrafficRow) int {
		x, y := float64(a.In)+float64(a.Out), float64(b.In)+float64(b.Out)
		if x > y {
			return -1
		}
		if x < y {
			return 1
		}
		return 0
	})
	if len(rows) == 0 {
		text.WriteString("暂无可核实记录。\n")
	}
	for i, row := range rows[:min(len(rows), 10)] {
		fmt.Fprintf(&text, "%d. %s（ID %d）\n↑ %s · ↓ %s · 合计 %s\n", i+1, row.Name, row.ID, telegramBytes(float64(row.Out)), telegramBytes(float64(row.In)), telegramBytes(float64(row.Out)+float64(row.In)))
	}
	text.WriteString(telegramTrafficFooter(sum))
	return text.String()
}

func telegramTrafficDateKind(kind string) bool {
	if len(kind) != 13 || !strings.HasPrefix(kind, "day") {
		return false
	}
	_, err := time.Parse("2006-01-02", kind[3:])
	return err == nil
}
