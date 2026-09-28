package model

import "time"

// Stored separately from Server so editing its metadata cannot overwrite history.
// UUID identity survives display-ID reassignment and cannot mix histories on ID reuse.
type ServerIPHistoryEntry struct {
	IP        IP        `json:"ip"`
	ChangedAt time.Time `json:"changed_at"`
}
type ServerIPHistory struct {
	ServerUUID string                 `gorm:"primaryKey" json:"-"`
	CurrentIP  IP                     `gorm:"serializer:json;type:text" json:"-"`
	History    []ServerIPHistoryEntry `gorm:"serializer:json;type:text" json:"-"`
}
