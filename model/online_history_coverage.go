package model

import "time"

// OnlineHistoryCoverage marks the earliest observed monitoring time. Unknown
// time before installation or an explicit full replacement is not an outage.
type OnlineHistoryCoverage struct {
	ServerID  uint64    `gorm:"primaryKey;autoIncrement:false" json:"server_id"`
	StartedAt time.Time `json:"started_at"`
}
