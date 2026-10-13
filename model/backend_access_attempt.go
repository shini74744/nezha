package model

// BackendAccessAttempt is an independent, expiring dashboard-entry ban.
// Never add it to the global WAF: frontends, Agents and PAT integrations stay separate.
type BackendAccessAttempt struct {
	IP                string `gorm:"primaryKey;size:64"`
	CredentialVersion string `gorm:"size:64"`
	Failures          int
	BannedUntil       int64
	ExpiresAt         int64 `gorm:"index"`
}
