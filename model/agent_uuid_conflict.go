package model

// A warning about overlapping authenticated state-report streams, not proof of
// distinct physical machines. No credential or fingerprint is retained.
type AgentUUIDConflict struct {
	UUID          string `gorm:"primaryKey;size:36" json:"uuid"`
	PreviousIP    string `gorm:"size:64" json:"previous_ip"`
	LastIP        string `gorm:"size:64" json:"last_ip"`
	PreviousPeer  string `gorm:"size:128" json:"previous_peer"`
	LastPeer      string `gorm:"size:128" json:"last_peer"`
	FirstReportAt int64  `json:"first_report_at"`
	LastReportAt  int64  `gorm:"index" json:"last_report_at"`
	ReportCount   uint64 `json:"report_count"`
}
