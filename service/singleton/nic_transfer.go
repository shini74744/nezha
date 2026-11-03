package singleton

import (
	"errors"
	"fmt"
	"github.com/goccy/go-json"
	"github.com/nezhahq/nezha/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"math"
	"time"
)

// Runs in the same identity-fenced transaction as the accepted snapshot.
// No writes for legacy Agents. Never infer NIC bytes from aggregate history.
func recordNICTransferTx(tx *gorm.DB, uuid string, s model.RecordedServerState) error {
	rows := make(map[string]model.NetworkInterfaceSpeed)
	if s.State == nil {
		return nil
	}
	for _, n := range s.State.NetworkInterfaces {
		if len(rows) >= model.MaxNetworkInterfaceRates {
			break
		}
		if !n.CountersAvailable || !model.ValidNetworkInterfaceName(n.Name) || n.CounterEpoch == "" || len(n.CounterEpoch) > 64 || n.InTransfer > math.MaxInt64 || n.OutTransfer > math.MaxInt64 {
			continue
		}
		if _, ok := rows[n.Name]; !ok {
			rows[n.Name] = n
		}
	}
	if len(rows) == 0 {
		return nil
	}
	var checkpoint model.NICTransferCheckpoint
	err := tx.First(&checkpoint, "uuid = ?", uuid).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	previous := map[string]model.NICCounterCheckpoint{}
	if checkpoint.Payload != "" {
		if err = json.Unmarshal([]byte(checkpoint.Payload), &previous); err != nil {
			return err
		}
	}
	next := map[string]model.NICCounterCheckpoint{}
	days := map[string]map[string]model.NICDayTraffic{}
	newest := int64(0)
	for _, last := range previous {
		newest = max(newest, last.At)
	}
	if s.At <= newest {
		return nil
	}
	for name, n := range rows {
		last := previous[name]
		start := last.CoveredFrom
		if start == 0 {
			start = s.At
		}
		next[name] = model.NICCounterCheckpoint{At: s.At, In: n.InTransfer, Out: n.OutTransfer, Epoch: n.CounterEpoch, CoveredFrom: start}
		if last.At == 0 {
			continue
		}
		boundary := n.CounterEpoch != last.Epoch || n.InTransfer < last.In || n.OutTransfer < last.Out
		in, out := uint64(0), uint64(0)
		if !boundary {
			in, out = n.InTransfer-last.In, n.OutTransfer-last.Out
		}
		from := last.At
		// Bound pathological/years-old intervals; discarded intervals are marked partial.
		if s.At-from > int64(366*24*time.Hour/time.Millisecond) {
			from = s.At
			boundary = true
		}
		slices := splitTrafficDays(uuid, from, s.At, in, out, boundary || s.At-last.At > 120000)
		if len(slices) == 0 && boundary {
			slices = []model.PlanTrafficDay{{Day: time.UnixMilli(s.At).In(model.PlanTrafficZone).Format("2006-01-02"), Estimated: true}}
		}
		for _, part := range slices {
			if days[part.Day] == nil {
				var saved model.NICTransferDay
				err := tx.First(&saved, "uuid = ? AND day = ?", uuid, part.Day).Error
				if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
					return err
				}
				day := map[string]model.NICDayTraffic{}
				if saved.Payload != "" {
					if err = json.Unmarshal([]byte(saved.Payload), &day); err != nil {
						return err
					}
				}
				days[part.Day] = day
			}
			day := days[part.Day][name]
			if math.MaxInt64-day.In < part.In || math.MaxInt64-day.Out < part.Out {
				return errors.New("NIC traffic overflow")
			}
			day.In += part.In
			day.Out += part.Out
			day.Partial = day.Partial || boundary
			day.Estimated = day.Estimated || part.Estimated
			days[part.Day][name] = day
		}
	}
	// A missing interface loses its baseline; reappearance starts a new coverage
	// interval instead of attributing an unknown gap to today's traffic.
	for date, day := range days {
		payload, err := json.Marshal(day)
		if err != nil {
			return err
		}
		if err = tx.Clauses(clause.OnConflict{UpdateAll: true}).Create(&model.NICTransferDay{UUID: uuid, Day: date, Payload: string(payload)}).Error; err != nil {
			return err
		}
	}
	payload, err := json.Marshal(next)
	if err != nil {
		return err
	}
	return tx.Clauses(clause.OnConflict{UpdateAll: true}).Create(&model.NICTransferCheckpoint{UUID: uuid, Payload: string(payload)}).Error
}

func QueryHomePlanTraffic(server *model.Server, now time.Time) (*model.PlanTrafficStat, error) {
	names := server.HomeNetworkNames()
	if len(names) == 0 {
		return QueryPlanTraffic(server, now)
	}
	plan, err := model.ParseTrafficPlan(server.PublicNote)
	if err != nil {
		return &model.PlanTrafficStat{Name: "套餐月流量", Error: err.Error()}, nil
	}
	if plan == nil {
		return nil, nil
	}
	from, to := model.PlanTrafficCycle(now, plan.ResetDay)
	stat := &model.PlanTrafficStat{ScopeKey: server.HomeNetworkScopeKey(), Name: "套餐月流量", QuotaType: plan.QuotaType, From: from, To: to, Max: plan.Max, Direction: plan.Direction, ResetDay: plan.ResetDay}
	err = DB.Transaction(func(tx *gorm.DB) error {
		var saved model.NICTransferCheckpoint
		err := tx.First(&saved, "uuid = ?", server.UUID).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			stat.Partial = true
			stat.Error = "所选网卡暂无流量记录"
			return nil
		}
		if err != nil {
			return err
		}
		points := map[string]model.NICCounterCheckpoint{}
		if err = json.Unmarshal([]byte(saved.Payload), &points); err != nil {
			return err
		}
		for _, name := range names {
			p, ok := points[name]
			if !ok {
				stat.Partial = true
			}
			stat.RecordedFrom = max(stat.RecordedFrom, p.CoveredFrom)
			if stat.LastReportAt == 0 || p.At < stat.LastReportAt {
				stat.LastReportAt = p.At
			}
		}
		stat.Partial = stat.Partial || stat.RecordedFrom > from.UnixMilli()
		var days []model.NICTransferDay
		if err = tx.Where("uuid = ? AND day >= ? AND day < ?", server.UUID, from.Format("2006-01-02"), to.Format("2006-01-02")).Find(&days).Error; err != nil {
			return err
		}
		for _, saved := range days {
			day := map[string]model.NICDayTraffic{}
			if err = json.Unmarshal([]byte(saved.Payload), &day); err != nil {
				return err
			}
			for _, name := range names {
				n := day[name]
				if math.MaxUint64-stat.In < n.In || math.MaxUint64-stat.Out < n.Out {
					return fmt.Errorf("NIC traffic overflow")
				}
				stat.In += n.In
				stat.Out += n.Out
				stat.Partial = stat.Partial || n.Partial
				stat.Estimated = stat.Estimated || n.Estimated
			}
		}
		switch plan.Direction {
		case "1":
			stat.Used = stat.In
		case "3":
			stat.Used = stat.Out
		default:
			if math.MaxUint64-stat.In < stat.Out {
				return errors.New("NIC traffic overflow")
			}
			stat.Used = stat.In + stat.Out
		}
		return nil
	})
	return stat, err
}
