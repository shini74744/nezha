package singleton

import (
	"context"
	"encoding/json"
	"github.com/nezhahq/nezha/model"
	"time"
)

var snapshotWriteGate = make(chan struct{}, 1)

// PersistServerSnapshot returns only after its SQLite transaction completes.
// RPC logs storage failures without taking otherwise healthy agents offline. The INSERT SELECT prevents stale streams resurrecting rows
// after deletion/ID reuse. No live inventory state is restored from this table.
func PersistServerSnapshot(id uint64, uuid string, sample model.RecordedServerState) error {
	if DB == nil || sample.State == nil || sample.At <= 0 || uuid == "" {
		return nil
	}
	payload, err := json.Marshal(sample)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return serverSnapshotWriter.persist(&snapshotWriteRequest{
		db: DB, ctx: ctx, id: id, uuid: uuid, sample: sample, payload: string(payload),
		result: make(chan error, 1),
	})
}

func QueryServerSnapshot(id uint64, uuid string, days int) (*model.ServerLastReport, error) {
	if DB == nil {
		return nil, nil
	}
	var rows []model.ServerSnapshot
	if err := DB.Where("server_id = ? AND uuid = ?", id, uuid).Order("recorded_at DESC").Limit(61).Find(&rows).Error; err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	result := &model.ServerLastReport{ServerID: id, TSDBEnabled: TSDBEnabled(), HistoryDays: days, SnapshotSeconds: 60,
		Metrics: map[string]float64{}, Recent: map[string][]model.ServerMetricsDataPoint{}}
	for i := len(rows) - 1; i >= 0; i-- {
		var sample model.RecordedServerState
		if err := json.Unmarshal([]byte(rows[i].Payload), &sample); err != nil {
			return nil, err
		}
		if sample.State == nil {
			continue
		}
		if sample.At < rows[0].RecordedAt-60000 {
			continue
		}
		result.Snapshot = &sample
		result.LastReportAt = sample.At
		result.Metrics = sample.Metrics()
		for key, value := range result.Metrics {
			result.Recent[key] = append(result.Recent[key], model.ServerMetricsDataPoint{Timestamp: sample.At, Value: value})
		}
	}
	return result, nil
}
