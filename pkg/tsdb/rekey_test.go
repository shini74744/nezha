package tsdb

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/VictoriaMetrics/VictoriaMetrics/lib/storage"
	"github.com/stretchr/testify/require"
)

func TestRemapServerIDsPreservesServerAndServiceHistory(t *testing.T) {
	config := &Config{
		DataPath:           filepath.Join(t.TempDir(), "tsdb"),
		RetentionDays:      1,
		MinFreeDiskSpaceGB: 0.001,
		DedupInterval:      time.Millisecond,
	}
	db, err := Open(config)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	at := time.Now().Add(-time.Minute)
	// ID 1 is an orphaned historical label. Reassigning server 10 to ID 1
	// must replace it, not merge unrelated history into the new server.
	require.NoError(t, db.WriteServerMetrics(&ServerMetrics{
		ServerID: 1, Timestamp: at.Add(-time.Second), CPU: 99,
	}))
	require.NoError(t, db.WriteServerMetrics(&ServerMetrics{
		ServerID: 10, Timestamp: at, CPU: 11,
	}))
	require.NoError(t, db.WriteServerMetrics(&ServerMetrics{
		ServerID: 20, Timestamp: at, CPU: 22,
	}))
	require.NoError(t, db.WriteServiceMetrics(&ServiceMetrics{
		ServiceID: 7, ServerID: 10, Timestamp: at, Delay: 33, Successful: true,
	}))
	require.NoError(t, db.WriteServiceMetrics(&ServiceMetrics{
		ServiceID: 7, ServerID: 20, Timestamp: at, Delay: 44, Successful: false,
	}))
	db.Flush()
	require.NoError(t, db.PauseWritesForMaintenance())
	require.True(t, db.WritesPaused())
	snapshot, err := db.CreateMaintenanceSnapshot()
	require.NoError(t, err)
	require.NotEmpty(t, snapshot)
	_, err = os.Stat(filepath.Join(config.DataPath, "snapshots", snapshot))
	require.NoError(t, err)
	require.NoError(t, db.RemapServerIDs(map[uint64]uint64{10: 1, 20: 2}))
	db.ResumeWritesAfterMaintenance()
	require.False(t, db.WritesPaused())

	serverOne, err := db.QueryServerMetrics(1, MetricServerCPU, Period1Day)
	require.NoError(t, err)
	require.NotEmpty(t, serverOne)
	for _, sample := range serverOne {
		require.NotEqual(t, float64(99), sample.Value)
	}
	require.InDelta(t, 11, serverOne[len(serverOne)-1].Value, 0.01)

	serverTwo, err := db.QueryServerMetrics(2, MetricServerCPU, Period1Day)
	require.NoError(t, err)
	require.NotEmpty(t, serverTwo)
	require.InDelta(t, 22, serverTwo[len(serverTwo)-1].Value, 0.01)

	old, err := db.QueryServerMetrics(10, MetricServerCPU, Period1Day)
	require.NoError(t, err)
	require.Empty(t, old)

	serviceOne, err := db.QueryServiceHistoryByServerID(1, Period1Day)
	require.NoError(t, err)
	require.Contains(t, serviceOne, uint64(7))

	serviceTwo, err := db.QueryServiceHistoryByServerID(2, Period1Day)
	require.NoError(t, err)
	require.Contains(t, serviceTwo, uint64(7))
}

func TestDeleteServerIDsRemovesOnlyTargetServerSeries(t *testing.T) {
	config := &Config{
		DataPath:           filepath.Join(t.TempDir(), "tsdb"),
		RetentionDays:      1,
		MinFreeDiskSpaceGB: 0.001,
		DedupInterval:      time.Millisecond,
	}
	db, err := Open(config)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	at := time.Now().Add(-time.Minute)
	require.NoError(t, db.WriteServerMetrics(&ServerMetrics{
		ServerID: 11, Timestamp: at, CPU: 11,
	}))
	require.NoError(t, db.WriteServiceMetrics(&ServiceMetrics{
		ServiceID: 7, ServerID: 11, Timestamp: at, Delay: 11, Successful: true,
	}))
	require.NoError(t, db.WriteServerMetrics(&ServerMetrics{
		ServerID: 12, Timestamp: at, CPU: 12,
	}))
	require.NoError(t, db.WriteServiceMetrics(&ServiceMetrics{
		ServiceID: 7, ServerID: 12, Timestamp: at, Delay: 12, Successful: true,
	}))
	db.Flush()

	require.NoError(t, db.DeleteServerIDs([]uint64{11}))
	require.False(t, db.WritesPaused())

	deletedMetrics, err := db.QueryServerMetrics(11, MetricServerCPU, Period1Day)
	require.NoError(t, err)
	require.Empty(t, deletedMetrics)
	deletedServices, err := db.QueryServiceHistoryByServerID(11, Period1Day)
	require.NoError(t, err)
	require.Empty(t, deletedServices)

	keptMetrics, err := db.QueryServerMetrics(12, MetricServerCPU, Period1Day)
	require.NoError(t, err)
	require.NotEmpty(t, keptMetrics)
	keptServices, err := db.QueryServiceHistoryByServerID(12, Period1Day)
	require.NoError(t, err)
	require.Contains(t, keptServices, uint64(7))
}

func TestRemapServerIDsCyclicMultiBlockHistory(t *testing.T) {
	config := &Config{DataPath: filepath.Join(t.TempDir(), "tsdb"), RetentionDays: 1,
		MinFreeDiskSpaceGB: 0.001, MaxMemoryMB: 64, DedupInterval: time.Millisecond}
	db, err := Open(config)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	ids := []uint64{10, 20, 30}
	at := time.Now().Add(-2 * time.Hour).Truncate(time.Second)
	for i := 0; i < 2049; i++ {
		for _, id := range ids {
			require.NoError(t, db.WriteServerMetrics(&ServerMetrics{
				ServerID: id, Timestamp: at.Add(time.Duration(i) * time.Second),
				CPU: float64(id + uint64(i%13)), MemUsed: id*1024 + uint64(i),
				DiskUsed: id*1024*1024 + uint64(i),
			}))
		}
		if i%257 == 0 {
			db.Flush()
		}
	}
	db.Flush()
	metrics := []MetricType{MetricServerCPU, MetricServerMemory, MetricServerDisk}
	before := map[uint64]map[MetricType][]MetricDataPoint{}
	for _, id := range ids {
		before[id] = map[MetricType][]MetricDataPoint{}
		for _, metric := range metrics {
			points, err := db.QueryServerMetrics(id, metric, Period1Day)
			require.NoError(t, err)
			require.NotEmpty(t, points)
			before[id][metric] = points
		}
	}
	mapping := map[uint64]uint64{10: 20, 20: 30, 30: 10}
	require.NoError(t, db.PauseWritesForMaintenance())
	require.NoError(t, db.RemapServerIDs(mapping))
	for oldID, newID := range mapping {
		for _, metric := range metrics {
			points, err := db.QueryServerMetrics(newID, metric, Period1Day)
			require.NoError(t, err)
			require.Equal(t, before[oldID][metric], points, "old=%d new=%d metric=%s", oldID, newID, metric)
		}
	}
}

func TestRemapServerIDsAcrossPartitionWithDeletedTarget(t *testing.T) {
	config := &Config{DataPath: filepath.Join(t.TempDir(), "tsdb"), RetentionDays: 90,
		MinFreeDiskSpaceGB: 0.001, MaxMemoryMB: 64, DedupInterval: time.Millisecond}
	db, err := Open(config)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	now := time.Now().UTC()
	boundary := time.Date(now.Year(), now.Month()-1, 1, 0, 0, 0, 0, time.UTC)
	at := boundary.Add(-2048 * time.Second)
	for i := 0; i < 4097; i++ {
		require.NoError(t, db.WriteServerMetrics(&ServerMetrics{ServerID: 10,
			Timestamp: at.Add(time.Duration(i) * time.Second), CPU: float64(i % 97)}))
	}
	// This target label exists only in the later partition. Its cached metric ID
	// becomes deleted there, but is not marked deleted in the earlier partition.
	require.NoError(t, db.WriteServerMetrics(&ServerMetrics{ServerID: 1,
		Timestamp: boundary.Add(time.Minute), CPU: 999}))
	db.Flush()
	read := func(id string) map[int64]float64 {
		f := storage.NewTagFilters()
		require.NoError(t, f.Add(nil, []byte(MetricServerCPU), false, false))
		require.NoError(t, f.Add([]byte("server_id"), []byte(id), false, false))
		tr := storage.TimeRange{MinTimestamp: at.UnixMilli(), MaxTimestamp: boundary.Add(time.Hour).UnixMilli()}
		var search storage.Search
		search.Init(nil, db.storage, []*storage.TagFilters{f}, tr, 1000, uint64(time.Now().Add(time.Minute).Unix()))
		defer search.MustClose()
		result := map[int64]float64{}
		for search.NextMetricBlock() {
			var block storage.Block
			search.MetricBlockRef.BlockRef.MustReadBlock(&block)
			require.NoError(t, block.UnmarshalData())
			times, values := block.AppendRowsWithTimeRangeFilter(nil, nil, tr)
			for i, timestamp := range times {
				result[timestamp] = values[i]
			}
		}
		require.NoError(t, search.Error())
		return result
	}
	before := read("10")
	require.Len(t, before, 4097)
	require.NoError(t, db.PauseWritesForMaintenance())
	require.NoError(t, db.RemapServerIDs(map[uint64]uint64{10: 1}))
	after := read("1")
	require.Equal(t, len(before), len(after), "cross-partition import must not reuse an ID deleted in the next partition")
	require.Equal(t, before, after)
}
