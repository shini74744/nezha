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
