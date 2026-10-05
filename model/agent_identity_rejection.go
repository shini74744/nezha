package model

const (
	AgentIdentityUUIDMissing = "uuid_missing"
	AgentIdentityUUIDInvalid = "uuid_invalid"
)

// No valid UUID exists for these attempts. Group by normalized source IP and
// reason, never by arbitrary user input. Raw UUID values and secrets are omitted.
type AgentIdentityRejection struct {
	IP            string `gorm:"primaryKey;size:64" json:"ip"`
	Reason        string `gorm:"primaryKey;size:32" json:"reason"`
	FirstReportAt int64  `json:"first_report_at"`
	LastReportAt  int64  `gorm:"index" json:"last_report_at"`
	ReportCount   uint64 `json:"report_count"`
}
