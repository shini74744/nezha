package model

import "time"

// ServerDeletionTombstone permanently blocks a deleted Agent UUID from
// registering again. The server's reusable numeric ID is intentionally not
// stored here: only the immutable Agent identity survives permanent deletion.
type ServerDeletionTombstone struct {
	UUID          string    `gorm:"primaryKey;size:36" json:"uuid"`
	CreatedAt     time.Time `gorm:"index;<-:create" json:"created_at"`
	Name          string    `json:"name"`
	LastIP        string    `gorm:"size:64" json:"last_ip"`
	FirstReportAt int64     `gorm:"default:0" json:"first_report_at"`
	LastReportAt  int64     `gorm:"index;default:0" json:"last_report_at"`
	ReportCount   uint64    `gorm:"default:0" json:"report_count"`
}
