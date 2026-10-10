package model

// One durable watermark per notification. Claim is persisted before sending:
// a process crash or ambiguous timeout must not replay a possibly delivered report.
type TelegramDailyDelivery struct {
	NotificationID uint64 `gorm:"primaryKey"`
	LastDay        string `gorm:"size:10"`
	ClaimDay       string `gorm:"size:10"`
	State          string `gorm:"size:16"`
	RetryAt        int64
	Attempts       int
}
