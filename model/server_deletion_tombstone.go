package model

import "time"

// ServerDeletionTombstone permanently blocks a deleted Agent UUID from
// registering again. The server's reusable numeric ID is intentionally not
// stored here: only the immutable Agent identity survives permanent deletion.
type ServerDeletionTombstone struct {
	UUID      string    `gorm:"primaryKey;size:36" json:"uuid"`
	CreatedAt time.Time `gorm:"index;<-:create" json:"created_at"`
}
