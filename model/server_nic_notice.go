package model

// ServerNICNotice stores one unread reminder per machine. EventID only
// deduplicates repeated reports; this table does not retain change history.
type ServerNICNotice struct {
	UUID    string `gorm:"primaryKey;size:64" json:"-"`
	EventID string `gorm:"size:64;not null" json:"event_id"`
	Unread  bool   `gorm:"not null" json:"-"`
}
