package tsdb

import (
	"fmt"
	"github.com/VictoriaMetrics/VictoriaMetrics/lib/storage"
	"github.com/nezhahq/nezha/model"
	"math"
	"strconv"
	"strings"
	"time"
)

// QueryLastServerReport reads raw timestamps, not rounded/averaged history.
// Bounded memory: first locate the last CPU sample, then read only its last 15 minutes.
func (db *TSDB) QueryLastServerReport(id uint64, days int) (*model.ServerLastReport, error) {
	db.mu.RLock()
	defer db.mu.RUnlock()
	if db.closed {
		return nil, fmt.Errorf("TSDB is closed")
	}
	if days < 1 || days > 30 {
		return nil, fmt.Errorf("invalid history limit")
	}
	result := &model.ServerLastReport{ServerID: id, TSDBEnabled: true, HistoryDays: days,
		Metrics: map[string]float64{}, Recent: map[string][]model.ServerMetricsDataPoint{}}
	now := time.Now()
	min := now.Add(-time.Duration(days) * 24 * time.Hour).UnixMilli()
	tr := storage.TimeRange{MinTimestamp: min, MaxTimestamp: now.UnixMilli()}
	// Recent windows usually avoid scanning a full month for an offline node.
	end := tr.MaxTimestamp
	for _, span := range []time.Duration{time.Hour, 24 * time.Hour, 7 * 24 * time.Hour, 30 * 24 * time.Hour} {
		start := now.Add(-span).UnixMilli()
		if start < min {
			start = min
		}
		window := storage.TimeRange{MinTimestamp: start, MaxTimestamp: end}
		err := db.visitServerSamples(id, string(MetricServerCPU), window, func(_ string, ts int64, _ float64) {
			if ts > result.LastReportAt {
				result.LastReportAt = ts
			}
		})
		if err != nil {
			return nil, err
		}
		if result.LastReportAt > 0 || start == min {
			break
		}
		end = start - 1
	}
	if result.LastReportAt == 0 {
		return result, nil
	}
	tr.MaxTimestamp = result.LastReportAt
	tr.MinTimestamp = max(min, result.LastReportAt-(15*time.Minute).Milliseconds())
	series := map[string][]rawDataPoint{}
	err := db.visitServerSamples(id, "nezha_server_.*", tr, func(name string, ts int64, value float64) {
		key := strings.TrimPrefix(name, "nezha_server_")
		if ts == result.LastReportAt {
			result.Metrics[key] = value
		}
		series[key] = append(series[key], rawDataPoint{timestamp: ts, value: value})
	})
	if err != nil {
		return nil, err
	}
	for key, points := range series {
		result.Recent[key] = downsampleMetrics(points, 30*time.Second, isCumulativeMetric(MetricType("nezha_server_"+key)))
	}
	return result, nil
}

func (db *TSDB) visitServerSamples(id uint64, metric string, tr storage.TimeRange, visit func(string, int64, float64)) error {
	filters := storage.NewTagFilters()
	if err := filters.Add(nil, []byte(metric), false, strings.HasSuffix(metric, ".*")); err != nil {
		return err
	}
	if err := filters.Add([]byte("server_id"), []byte(strconv.FormatUint(id, 10)), false, false); err != nil {
		return err
	}
	var search storage.Search
	search.Init(nil, db.storage, []*storage.TagFilters{filters}, tr, 1000, uint64(time.Now().Add(15*time.Second).Unix()))
	defer search.MustClose()
	var timestamps []int64
	var values []float64
	for search.NextMetricBlock() {
		ref := search.MetricBlockRef
		var name storage.MetricName
		if err := name.Unmarshal(ref.MetricName); err != nil {
			return err
		}
		var block storage.Block
		ref.BlockRef.MustReadBlock(&block)
		if err := block.UnmarshalData(); err != nil {
			return err
		}
		timestamps, values = block.AppendRowsWithTimeRangeFilter(timestamps[:0], values[:0], tr)
		for i, ts := range timestamps {
			if !math.IsNaN(values[i]) && !math.IsInf(values[i], 0) {
				visit(string(name.MetricGroup), ts, values[i])
			}
		}
	}
	return search.Error()
}
