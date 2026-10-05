package singleton

import (
	"context"
	"net"
	"time"

	"github.com/nezhahq/nezha/model"
	"gorm.io/gorm"
)

// RecordDeletedAgentReport updates existing tombstones only: untrusted peers
// cannot create unlimited UUID rows. It never stores credentials or blocks an IP.
// Failure to record telemetry must never change the authentication decision.
func RecordDeletedAgentReport(uuid, ip string) {
	if DB == nil || !IsDeletedServerUUID(uuid) {
		return
	}
	parsed := net.ParseIP(ip)
	ip = ""
	if parsed != nil {
		ip = parsed.String()
	}
	now := time.Now().Unix()
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	DB.WithContext(ctx).Model(&model.ServerDeletionTombstone{}).Where("uuid = ?", uuid).Updates(map[string]any{
		"last_ip":         ip,
		"last_report_at":  now,
		"first_report_at": gorm.Expr("CASE WHEN first_report_at = 0 THEN ? ELSE first_report_at END", now),
		"report_count":    gorm.Expr("report_count + 1"),
	})
}

// A bounded, best-effort record of rejected, well-formed UUIDs, including
// existing nodes with invalid or missing credentials. Deleted UUIDs use their
// tombstone. Valid registration remains untouched.
// Cardinality is capped because these identities are controlled by peers.
func RecordAgentAuthFailure(uuid, ip string) {
	if DB == nil || IsDeletedServerUUID(uuid) {
		return
	}
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return
	}
	now := time.Now().Unix()
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	// UPDATE first avoids a table count on retries; count+1 remains atomic.
	db := DB.WithContext(ctx)
	result := db.Model(&model.UnknownAgentReport{}).Where("uuid = ?", uuid).
		Updates(map[string]any{"last_ip": parsed.String(), "last_report_at": now, "report_count": gorm.Expr("report_count + 1")})
	if result.Error != nil || result.RowsAffected > 0 {
		return
	}
	// SQLite serializes this single INSERT statement, including its cap check.
	// Preserve existing records at the cap, rather than grow without bound.
	db.Exec(`INSERT INTO unknown_agent_reports (uuid, last_ip, first_report_at, last_report_at, report_count)
        SELECT ?, ?, ?, ?, 1 WHERE (SELECT COUNT(*) FROM unknown_agent_reports) < 10000
        ON CONFLICT(uuid) DO UPDATE SET last_ip = excluded.last_ip, last_report_at = excluded.last_report_at, report_count = report_count + 1`,
		uuid, parsed.String(), now, now)
}
