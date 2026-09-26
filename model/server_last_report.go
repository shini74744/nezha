package model

// ServerLastReport contains only recorded measurements, never invented zeros.
type ServerLastReport struct {
	Snapshot        *RecordedServerState                `json:"snapshot,omitempty"`
	SnapshotSeconds int                                 `json:"snapshot_seconds,omitempty"`
	ServerID        uint64                              `json:"server_id"`
	TSDBEnabled     bool                                `json:"tsdb_enabled"`
	HistoryDays     int                                 `json:"history_days"`
	LastReportAt    int64                               `json:"last_report_at,omitempty"`
	Metrics         map[string]float64                  `json:"metrics"`
	Recent          map[string][]ServerMetricsDataPoint `json:"recent"`
}
