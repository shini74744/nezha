package model

// Registered and unregistered UUIDs rejected during authentication are recorded.
// Deleted UUID reports use the permanent deletion tombstone instead.
type UnknownAgentReport struct {
	UUID          string `gorm:"primaryKey;size:36" json:"uuid"`
	LastIP        string `gorm:"size:64" json:"last_ip"`
	FirstReportAt int64  `json:"first_report_at"`
	LastReportAt  int64  `gorm:"index" json:"last_report_at"`
	ReportCount   uint64 `json:"report_count"`
}

type UnknownAgentReportView struct {
	UUID          string `json:"uuid"`
	Name          string `json:"name"`
	Kind          string `json:"kind"`
	ReleasedAt    int64  `json:"released_at"`
	BlockVersion  uint64 `json:"block_version"`
	PreviousIP    string `json:"previous_ip,omitempty"`
	PreviousPeer  string `json:"previous_peer,omitempty"`
	LastPeer      string `json:"last_peer,omitempty"`
	LastIP        string `json:"last_ip"`
	FirstReportAt int64  `json:"first_report_at"`
	LastReportAt  int64  `json:"last_report_at"`
	ReportCount   uint64 `json:"report_count"`
}
