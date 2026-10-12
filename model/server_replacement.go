package model

import "time"

// A one-time replacement permission becomes the new node's scoped credential
// after its first complete report. Only its SHA-256 hash is stored.
type ServerReplacement struct {
	ID          uint64 `gorm:"primaryKey"`
	ServerUUID  string `gorm:"index"`
	OwnerID     uint64
	TokenHash   string `gorm:"uniqueIndex" json:"-"`
	State       string `gorm:"index"`
	CreatedAt   time.Time
	ExpiresAt   time.Time
	CompletedAt *time.Time
	ActorID     uint64
	ActorName   string
}
