package model

import "time"

// A credential is permanently bound to one UUID. Its block/release decision is
// the UUID tombstone, not a second independently mutable blacklist flag.
type AgentCredential struct {
	UUID               string    `gorm:"primaryKey;size:36" json:"uuid"`
	OwnerID            uint64    `gorm:"index;not null" json:"-"`
	SecretHash         string    `gorm:"size:64;uniqueIndex;not null" json:"-"`
	SecretSealed       []byte    `json:"-"`
	Version            uint64    `gorm:"not null;default:1" json:"version"`
	CreatedAt          time.Time `json:"created_at"`
	VerifiedAt         int64     `gorm:"not null;default:0" json:"verified_at"`
	MigrationRequested bool      `gorm:"not null;default:false" json:"-"`
	LastAttemptAt      int64     `gorm:"not null;default:0" json:"last_attempt_at"`
	LastError          string    `gorm:"not null;default:''" json:"last_error"`
}
type AgentCredentialRejection struct {
	ID            string `gorm:"primaryKey;size:64" json:"id"`
	UUID          string `gorm:"size:36;index" json:"uuid"`
	SecretHash    string `gorm:"size:64;index" json:"-"`
	SecretSealed  []byte `json:"-"`
	Fingerprint   string `gorm:"size:16" json:"fingerprint"`
	LastIP        string `gorm:"size:64" json:"last_ip"`
	FirstReportAt int64  `json:"first_report_at"`
	LastReportAt  int64  `gorm:"index" json:"last_report_at"`
	ReportCount   uint64 `json:"report_count"`
	AcceptedAt    int64  `gorm:"not null;default:0" json:"accepted_at"`
}
