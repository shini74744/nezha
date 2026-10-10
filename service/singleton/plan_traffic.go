package singleton

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/nezhahq/nezha/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Seed available legacy history once, before legacy rule-based cleanup. It is
// explicitly partial/estimated: hourly buckets cannot prove complete coverage.
func initPlanTraffic(db *gorm.DB, now time.Time) error {
	var servers []struct {
		ID   uint64
		UUID string
	}
	if err := db.Table("servers").Select("id,uuid").Where("uuid <> ''").Scan(&servers).Error; err != nil {
		return err
	}
	for _, s := range servers {
		if err := db.Transaction(func(tx *gorm.DB) error {
			var count int64
			if err := tx.Model(&model.PlanTrafficCheckpoint{}).Where("uuid = ?", s.UUID).Count(&count).Error; err != nil {
				return err
			}
			if count > 0 {
				return nil
			}
			// Existing hourly records are stamped at the end of their collection hour.
			var days []model.PlanTrafficDay
			if err := tx.Model(&model.Transfer{}).Select("date(created_at, '+8 hours', '-1 second') AS day, SUM(`in`) AS `in`, SUM(`out`) AS `out`").Where("server_id = ?", s.ID).Group("day").Scan(&days).Error; err != nil {
				return err
			}
			for _, day := range days {
				if day.Day == "" {
					continue
				}
				day.UUID = s.UUID
				day.Estimated = true
				day.Partial = true
				if err := tx.Create(&day).Error; err != nil {
					return err
				}
			}
			return tx.Create(&model.PlanTrafficCheckpoint{UUID: s.UUID, CoveredFrom: now.UnixMilli()}).Error
		}); err != nil {
			return fmt.Errorf("initialize independent traffic for %d: %w", s.ID, err)
		}
	}
	return nil
}

func PersistPlanTraffic(id uint64, uuid string, sample model.RecordedServerState) error {
	if DB == nil || uuid == "" || sample.State == nil || sample.At <= 0 {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	// Share the existing snapshot writer gate; never acquire a runtime holder here.
	select {
	case snapshotWriteGate <- struct{}{}:
	case <-ctx.Done():
		return ctx.Err()
	}
	defer func() { <-snapshotWriteGate }()
	return recordPlanTraffic(DB.WithContext(ctx), id, uuid, sample)
}
func recordPlanTraffic(db *gorm.DB, id uint64, uuid string, s model.RecordedServerState) error {
	return db.Transaction(func(tx *gorm.DB) error { return recordPlanTrafficTx(tx, id, uuid, s) })
}
func recordPlanTrafficTx(tx *gorm.DB, id uint64, uuid string, s model.RecordedServerState) error {
	if s.State == nil || s.At <= 0 || s.State.NetInTransfer > 1<<63-1 || s.State.NetOutTransfer > 1<<63-1 || s.State.Uptime > 100*366*86400 {
		return errors.New("invalid traffic sample")
	}
	var exists int64
	if err := tx.Table("servers").Where("id = ? AND uuid = ?", id, uuid).Count(&exists).Error; err != nil {
		return err
	}
	if exists == 0 {
		return nil
	} // Deleted streams / reassigned IDs cannot resurrect accounting.
	var last model.PlanTrafficCheckpoint
	err := tx.First(&last, "uuid = ?", uuid).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	if last.At >= s.At {
		return nil
	}
	if last.CoveredFrom == 0 {
		last.CoveredFrom = s.At
	}
	next := model.PlanTrafficCheckpoint{UUID: uuid, At: s.At, In: s.State.NetInTransfer, Out: s.State.NetOutTransfer, Uptime: s.State.Uptime, CoveredFrom: last.CoveredFrom}
	if last.At == 0 {
		// Never treat the agent's lifetime counter as this month's consumption.
		next.CoveredFrom = s.At
	} else {
		elapsed := (s.At - last.At) / 1000
		// Uptime can be cached or delivered late. It must never turn monotonic
		// counters into lifetime-sized deltas; handle each counter reset separately.
		uptimeMismatch := s.State.Uptime < last.Uptime || (last.Uptime > 0 && s.State.Uptime > 0 && s.State.Uptime+10 < last.Uptime+uint64(elapsed))
		delta := func(current, previous uint64) uint64 {
			if current < previous {
				return current
			}
			return current - previous
		}
		in, out := delta(next.In, last.In), delta(next.Out, last.Out)
		from := last.At
		estimated := uptimeMismatch || elapsed > 120 || next.In < last.In || next.Out < last.Out
		for _, day := range splitTrafficDays(uuid, from, s.At, in, out, estimated) {
			if err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "uuid"}, {Name: "day"}}, DoUpdates: clause.Assignments(map[string]any{
				"in": gorm.Expr("plan_traffic_days.`in` + excluded.`in`"), "out": gorm.Expr("plan_traffic_days.`out` + excluded.`out`"),
				"estimated": gorm.Expr("plan_traffic_days.estimated OR excluded.estimated"),
			})}).Create(&day).Error; err != nil {
				return err
			}
		}
	}
	return tx.Clauses(clause.OnConflict{UpdateAll: true}).Create(&next).Error
}

// Proportional allocation is only needed for the report interval crossing midnight.
// Preserve the exact byte sum; intervals spanning a gap are exposed as estimated.
func splitTrafficDays(uuid string, from, to int64, in, out uint64, estimated bool) []model.PlanTrafficDay {
	if to <= from {
		return nil
	}
	total := to - from
	remainingIn, remainingOut := in, out
	proportional := func(value uint64, ms int64) uint64 {
		n := new(big.Int).SetUint64(value)
		n.Mul(n, big.NewInt(ms))
		n.Div(n, big.NewInt(total))
		return n.Uint64()
	}
	var days []model.PlanTrafficDay
	for cursor := from; cursor < to; {
		date := time.UnixMilli(cursor).In(model.PlanTrafficZone)
		midnight := time.Date(date.Year(), date.Month(), date.Day()+1, 0, 0, 0, 0, model.PlanTrafficZone).UnixMilli()
		end := min(to, midnight)
		a, b := remainingIn, remainingOut
		if end < to {
			a = proportional(in, end-cursor)
			b = proportional(out, end-cursor)
		}
		remainingIn -= a
		remainingOut -= b
		days = append(days, model.PlanTrafficDay{UUID: uuid, Day: date.Format("2006-01-02"), In: a, Out: b, Estimated: estimated})
		cursor = end
	}
	return days
}

func QueryPlanTraffic(server *model.Server, now time.Time) (*model.PlanTrafficStat, error) {
	plan, err := model.ParseTrafficPlan(server.PublicNote)
	if err != nil {
		return &model.PlanTrafficStat{Name: "套餐月流量", Error: err.Error()}, nil
	}
	if plan == nil {
		return nil, nil
	}
	from, to := model.PlanTrafficCycle(now, plan.ResetDay)
	stat := &model.PlanTrafficStat{QuotaType: plan.QuotaType, Name: "套餐月流量", From: from, To: to, Max: plan.Max, Direction: plan.Direction, ResetDay: plan.ResetDay}
	err = DB.Transaction(func(tx *gorm.DB) error {
		var last model.PlanTrafficCheckpoint
		if err := tx.First(&last, "uuid = ?", server.UUID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				stat.Partial = true
				return nil
			}
			return err
		}
		stat.RecordedFrom = last.CoveredFrom
		stat.LastReportAt = last.At
		stat.Partial = last.CoveredFrom > from.UnixMilli()
		var sum struct {
			In        uint64
			Out       uint64
			Estimated bool
			Partial   bool
		}
		if err := tx.Model(&model.PlanTrafficDay{}).Select("COALESCE(SUM(CASE WHEN unreliable THEN 0 ELSE `in` END),0) AS `in`,COALESCE(SUM(CASE WHEN unreliable THEN 0 ELSE `out` END),0) AS `out`,COALESCE(MAX(estimated),0) AS estimated,COALESCE(MAX(partial OR unreliable),0) AS partial").
			Where("uuid = ? AND day >= ? AND day < ?", server.UUID, from.Format("2006-01-02"), to.Format("2006-01-02")).Scan(&sum).Error; err != nil {
			return err
		}
		stat.In, stat.Out, stat.Estimated = sum.In, sum.Out, sum.Estimated
		stat.Partial = stat.Partial || sum.Partial
		switch plan.Direction {
		case "1":
			stat.Used = sum.In
		case "3":
			stat.Used = sum.Out
		default:
			stat.Used = sum.In + sum.Out
		}
		return nil
	})
	return stat, err
}
