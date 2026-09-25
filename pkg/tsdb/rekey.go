package tsdb

import (
	"fmt"
	"log"
	"strconv"
	"time"

	"github.com/VictoriaMetrics/VictoriaMetrics/lib/prompb"
	"github.com/VictoriaMetrics/VictoriaMetrics/lib/storage"
)

// PauseWritesForMaintenance flushes buffered samples and rejects new writes
// until ResumeWritesAfterMaintenance is called. Queries remain available.
func (db *TSDB) PauseWritesForMaintenance() (err error) {
	db.mu.Lock()
	defer db.mu.Unlock()
	if db.closed {
		return fmt.Errorf("TSDB is closed")
	}
	if db.writer != nil {
		db.writer.flush()
	}

	// Serialize with any flush that already removed rows from the buffer. Set
	// the flag while holding ingestMu so a queued flush observes maintenance
	// mode and cannot add an old server_id after the snapshot starts.
	db.ingestMu.Lock()
	defer db.ingestMu.Unlock()
	db.maintenancePaused.Store(true)
	defer func() {
		if recovered := recover(); recovered != nil {
			db.maintenancePaused.Store(false)
			err = fmt.Errorf("flush TSDB for maintenance: %v", recovered)
		}
	}()
	db.storage.DebugFlush()
	return nil
}

func (db *TSDB) ResumeWritesAfterMaintenance() {
	db.maintenancePaused.Store(false)
}

// DeleteServerIDs permanently removes every server and service metric series
// tagged with one of the supplied system IDs. Writes are paused and flushed so
// a deleted Agent cannot leave a late sample that a future ID reuse inherits.
func (db *TSDB) DeleteServerIDs(serverIDs []uint64) error {
	if len(serverIDs) == 0 {
		return nil
	}
	if err := db.PauseWritesForMaintenance(); err != nil {
		return err
	}
	defer db.ResumeWritesAfterMaintenance()

	values := make([]string, 0, len(serverIDs))
	for _, id := range serverIDs {
		values = append(values, strconv.FormatUint(id, 10))
	}

	db.mu.Lock()
	defer db.mu.Unlock()
	if db.closed {
		return fmt.Errorf("TSDB is closed")
	}
	if err := db.deleteServerSeriesLocked(values); err != nil {
		return err
	}
	db.storage.DebugFlush()
	return nil
}

// CreateMaintenanceSnapshot creates a point-in-time TSDB snapshot before a
// destructive maintenance operation. VictoriaMetrics exposes a panic-only
// snapshot API, so convert that failure mode into an ordinary error.
func (db *TSDB) CreateMaintenanceSnapshot() (name string, err error) {
	db.mu.Lock()
	defer db.mu.Unlock()
	if db.closed {
		return "", fmt.Errorf("TSDB is closed")
	}
	if !db.maintenancePaused.Load() {
		return "", fmt.Errorf("TSDB writes must be paused before creating a maintenance snapshot")
	}
	defer func() {
		if recovered := recover(); recovered != nil {
			name = ""
			err = fmt.Errorf("create TSDB snapshot: %v", recovered)
		}
	}()
	return db.storage.MustCreateSnapshot(), nil
}

// RemapServerIDs rewrites every series carrying server_id according to mapping.
// Call PauseWritesForMaintenance first and keep writes paused until the process
// has rebuilt its server cache (the dashboard reassign endpoint restarts itself).
func (db *TSDB) RemapServerIDs(mapping map[uint64]uint64) error {
	db.mu.Lock()
	defer db.mu.Unlock()
	if db.closed {
		return fmt.Errorf("TSDB is closed")
	}
	if !db.maintenancePaused.Load() {
		return fmt.Errorf("TSDB writes must be paused before remapping server IDs")
	}

	nonce := strconv.FormatInt(time.Now().UnixNano(), 10)
	changed := make(map[string]string, len(mapping))
	affected := make(map[string]struct{}, len(mapping)*2)
	seenTargets := make(map[uint64]struct{}, len(mapping))
	for oldID, newID := range mapping {
		if _, exists := seenTargets[newID]; exists {
			return fmt.Errorf("duplicate target server ID %d", newID)
		}
		seenTargets[newID] = struct{}{}
		if oldID == newID {
			continue
		}
		oldValue := strconv.FormatUint(oldID, 10)
		newValue := strconv.FormatUint(newID, 10)
		changed[oldValue] = newValue
		affected[oldValue] = struct{}{}
		affected[newValue] = struct{}{}
	}
	if len(changed) == 0 {
		return nil
	}

	// Back up every affected label, including an orphaned target ID left by a
	// deleted server. This prevents unrelated historical samples from being
	// merged into a newly assigned system ID and lets ordinary errors roll back.
	backup := make(map[string]string, len(affected))
	for original := range affected {
		backup[original] = "__nezha_rekey_" + nonce + "_" + original
	}
	tr := storage.TimeRange{
		MinTimestamp: time.Now().Add(-time.Duration(db.config.RetentionDays+2) * 24 * time.Hour).UnixMilli(),
		MaxTimestamp: time.Now().Add(time.Hour).UnixMilli(),
	}
	for original, temporary := range backup {
		if err := db.copyServerSeriesLocked(original, temporary, tr); err != nil {
			_ = db.deleteServerSeriesLocked(values(backup))
			return fmt.Errorf("back up server series %s: %w", original, err)
		}
	}
	db.storage.DebugFlush()

	if err := db.deleteServerSeriesLocked(keys(affected)); err != nil {
		_ = db.restoreServerSeriesLocked(invert(backup), tr)
		return fmt.Errorf("delete affected server series: %w", err)
	}

	for oldValue, newValue := range changed {
		if err := db.copyServerSeriesLocked(backup[oldValue], newValue, tr); err != nil {
			_ = db.deleteServerSeriesLocked(keys(affected))
			_ = db.restoreServerSeriesLocked(invert(backup), tr)
			return fmt.Errorf("restore server %s as %s: %w", oldValue, newValue, err)
		}
	}
	db.storage.DebugFlush()
	if err := db.deleteServerSeriesLocked(values(backup)); err != nil {
		// The final labels are already complete. Treat temporary-label cleanup as
		// non-fatal so the SQLite IDs can commit consistently with TSDB.
		log.Printf("NEZHA>> failed to delete temporary TSDB rekey series: %v", err)
	}
	return nil
}
func (db *TSDB) restoreServerSeriesLocked(sourceToTarget map[string]string, tr storage.TimeRange) error {
	var firstErr error
	for source, target := range sourceToTarget {
		if err := db.copyServerSeriesLocked(source, target, tr); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	db.storage.DebugFlush()
	if firstErr == nil {
		if err := db.deleteServerSeriesLocked(keys(sourceToTarget)); err != nil {
			firstErr = err
		}
	}
	return firstErr
}

func (db *TSDB) copyServerSeriesLocked(source, target string, tr storage.TimeRange) error {
	tfs := storage.NewTagFilters()
	if err := tfs.Add([]byte("server_id"), []byte(source), false, false); err != nil {
		return err
	}
	deadline := uint64(time.Now().Add(10 * time.Minute).Unix())
	var search storage.Search
	search.Init(nil, db.storage, []*storage.TagFilters{tfs}, tr, 1_000_000, deadline)
	defer search.MustClose()

	rows := make([]storage.MetricRow, 0, 4096)
	for search.NextMetricBlock() {
		ref := search.MetricBlockRef
		var block storage.Block
		ref.BlockRef.MustReadBlock(&block)
		if err := block.UnmarshalData(); err != nil {
			return err
		}
		var name storage.MetricName
		if err := name.Unmarshal(ref.MetricName); err != nil {
			return err
		}
		name.SetTagBytes([]byte("server_id"), []byte(target))
		labels := make([]prompb.Label, 0, len(name.Tags)+1)
		labels = append(labels, prompb.Label{Name: "__name__", Value: string(name.MetricGroup)})
		for i := range name.Tags {
			labels = append(labels, prompb.Label{
				Name: string(name.Tags[i].Key), Value: string(name.Tags[i].Value),
			})
		}
		metricNameRaw := storage.MarshalMetricNameRaw(nil, labels)
		var timestamps []int64
		var values []float64
		timestamps, values = block.AppendRowsWithTimeRangeFilter(timestamps, values, tr)
		for i := range timestamps {
			rows = append(rows, storage.MetricRow{
				MetricNameRaw: metricNameRaw,
				Timestamp:     timestamps[i],
				Value:         values[i],
			})
			if len(rows) == cap(rows) {
				if err := db.addMaintenanceRowsLocked(rows); err != nil {
					return err
				}
				rows = rows[:0]
			}
		}
	}
	if err := search.Error(); err != nil {
		return err
	}
	return db.addMaintenanceRowsLocked(rows)
}
func (db *TSDB) addMaintenanceRowsLocked(rows []storage.MetricRow) (err error) {
	if len(rows) == 0 {
		return nil
	}
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("TSDB write failed: %v", recovered)
		}
	}()
	db.storage.AddRows(rows, 64)
	return nil
}

func (db *TSDB) deleteServerSeriesLocked(serverIDs []string) error {
	if len(serverIDs) == 0 {
		return nil
	}
	tfss := make([]*storage.TagFilters, 0, len(serverIDs))
	for _, id := range serverIDs {
		tfs := storage.NewTagFilters()
		if err := tfs.Add([]byte("server_id"), []byte(id), false, false); err != nil {
			return err
		}
		tfss = append(tfss, tfs)
	}
	_, err := db.storage.DeleteSeries(nil, tfss, 1_000_000)
	return err
}
func keys[T any](m map[string]T) []string {
	out := make([]string, 0, len(m))
	for key := range m {
		out = append(out, key)
	}
	return out
}

func values(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for _, value := range m {
		out = append(out, value)
	}
	return out
}

func invert(m map[string]string) map[string]string {
	out := make(map[string]string, len(m))
	for key, value := range m {
		out[value] = key
	}
	return out
}
