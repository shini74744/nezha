package model

import "time"

// ServerDeletionTombstone permanently blocks a deleted Agent UUID from
// registering again. OriginalID is a historical label, never an auth key or
// a foreign key: numeric IDs may be reassigned or reused by unrelated nodes.
type ServerDeletionTombstone struct {
	UUID          string    `gorm:"primaryKey;size:36" json:"uuid"`
	CreatedAt     time.Time `gorm:"index;<-:create" json:"created_at"`
	Name          string    `json:"name"`
	OriginalID    uint64    `json:"original_id"`
	DeletedByID   uint64    `json:"deleted_by_id"`
	DeletedByName string    `json:"deleted_by_name"`
	LastIP        string    `gorm:"size:64" json:"last_ip"`
	FirstReportAt int64     `gorm:"default:0" json:"first_report_at"`
	LastReportAt  int64     `gorm:"index;default:0" json:"last_report_at"`
	ReportCount   uint64    `gorm:"default:0" json:"report_count"`
}
