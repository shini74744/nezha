package tsdb

import (
	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"path/filepath"
	"testing"
	"time"
)

func TestPerInterfaceRatesAreSeparateHistoricalSeries(t *testing.T) {
	db, err := Open(&Config{DataPath: filepath.Join(t.TempDir(), "tsdb"), RetentionDays: 1, MinFreeDiskSpaceGB: 1, DedupInterval: time.Second})
	require.NoError(t, err)
	defer db.Close()
	at := time.Now().Add(-time.Minute)
	rows := []model.NetworkInterfaceSpeed{{Name: "eth0", InSpeed: 10, OutSpeed: 20, Available: true}, {Name: "eth1", InSpeed: 30, OutSpeed: 40, Available: true}, {Name: "idle", Available: true}, {Name: "warmup", InSpeed: 99}}
	require.NoError(t, db.WriteServerMetrics(&ServerMetrics{ServerID: 1, Timestamp: at, NetInSpeed: 40, NetOutSpeed: 60, NetworkInterfaces: rows}))
	require.NoError(t, db.WriteBatchServerMetrics([]*ServerMetrics{{ServerID: 2, Timestamp: at, NetworkInterfaces: rows}, {ServerID: 3, Timestamp: at, NetInSpeed: 99}}))
	db.Flush()
	for _, id := range []uint64{1, 2} {
		for _, n := range rows[:3] {
			for _, d := range []string{"in", "out"} {
				points, err := db.QueryServerMetrics(id, MetricType("nezha_server_"+model.NetworkInterfaceMetric(n.Name, d)), Period1Day)
				require.NoError(t, err)
				require.NotEmpty(t, points)
				want := n.InSpeed
				if d == "out" {
					want = n.OutSpeed
				}
				require.Equal(t, float64(want), points[0].Value)
			}
		}
		points, err := db.QueryServerMetrics(id, MetricType("nezha_server_"+model.NetworkInterfaceMetric("warmup", "in")), Period1Day)
		require.NoError(t, err)
		require.Empty(t, points)
	}
	points, err := db.QueryServerMetrics(3, MetricType("nezha_server_"+model.NetworkInterfaceMetric("eth0", "in")), Period1Day)
	require.NoError(t, err)
	require.Empty(t, points)
}
