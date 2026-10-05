package model

import "time"

// ServerDeletionTombstone blocks a deleted Agent UUID until an administrator
// explicitly releases it. Deletion/report history remains after release.
// OriginalID is a historical label, never an auth key or a foreign key:
// numeric IDs may be reassigned or reused by unrelated nodes.
type ServerDeletionTombstone struct {
	UUID           string    `gorm:"primaryKey;size:36" json:"uuid"`
	CreatedAt      time.Time `gorm:"index;<-:create" json:"created_at"`
	Name           string    `json:"name"`
	OriginalID     uint64    `json:"original_id"`
	DeletedByID    uint64    `json:"deleted_by_id"`
	DeletedByName  string    `json:"deleted_by_name"`
	LastIP         string    `gorm:"size:64" json:"last_ip"`
	FirstReportAt  int64     `gorm:"default:0" json:"first_report_at"`
	LastReportAt   int64     `gorm:"index;default:0" json:"last_report_at"`
	ReportCount    uint64    `gorm:"default:0" json:"report_count"`
	BlockVersion   uint64    `gorm:"not null;default:1" json:"block_version"`
	ReleasedAt     int64     `gorm:"not null;default:0" json:"released_at"`
	ReleasedByID   uint64    `gorm:"not null;default:0" json:"released_by_id"`
	ReleasedByName string    `gorm:"not null;default:''" json:"released_by_name"`
	// Cleanup is opt-in for this deletion generation, never inherited on re-delete.
	CleanupOwnerID        uint64 `gorm:"not null;default:0" json:"-"`
	CleanupCredentialHash string `gorm:"not null;default:''" json:"-"`
	CleanupPlatform       string `gorm:"not null;default:''" json:"cleanup_platform"`
	CleanupEnabled        bool   `gorm:"not null;default:false" json:"cleanup_enabled"`
	CleanupRevision       uint64 `gorm:"not null;default:0" json:"cleanup_revision"`
	CleanupState          string `gorm:"not null;default:'off'" json:"cleanup_state"`
	CleanupAttempts       uint64 `gorm:"not null;default:0" json:"cleanup_attempts"`
	CleanupLastAttemptAt  int64  `gorm:"not null;default:0" json:"cleanup_last_attempt_at"`
	CleanupMessage        string `gorm:"not null;default:''" json:"cleanup_message"`
	CleanupUnavailable    string `gorm:"-" json:"cleanup_unavailable"`
	// Legacy armed jobs retain their original one-shot budget. Only a new explicit
	// enable opts in to bounded retries.
	CleanupMaxAttempts    uint64 `gorm:"not null;default:1" json:"cleanup_max_attempts"`
	CleanupRoundAttempts  uint64 `gorm:"not null;default:0" json:"cleanup_round_attempts"`
	CleanupNextAttemptAt  int64  `gorm:"not null;default:0" json:"cleanup_next_attempt_at"`
	CleanupCheckedAt      int64  `gorm:"not null;default:0" json:"cleanup_checked_at"`
	CleanupLastVerifiedAt int64  `gorm:"not null;default:0" json:"cleanup_last_verified_at"`
	CleanupLastResult     string `gorm:"not null;default:''" json:"cleanup_last_result"`
}
