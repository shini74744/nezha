package singleton

import (
	"context"
	"net"
	"strings"
	"time"

	"github.com/hashicorp/go-uuid"
	"github.com/nezhahq/nezha/model"
	"gorm.io/gorm"
)

// Best-effort audit only: no authentication decisions or IP bans are changed.
// Use a separate bounded table because missing/malformed IDs must never be
// treated as registered node identities or stored as attacker-controlled text.
func RecordAgentIdentityRejection(reportedUUID, ip string) {
	if DB == nil {
		return
	}
	reportedUUID = strings.TrimSpace(reportedUUID)
	reason := model.AgentIdentityUUIDMissing
	if reportedUUID != "" {
		if _, err := uuid.ParseUUID(reportedUUID); err == nil {
			return
		}
		reason = model.AgentIdentityUUIDInvalid
	}
	parsed := net.ParseIP(ip)
	ip = ""
	if parsed != nil {
		ip = parsed.String()
	}
	now := time.Now().Unix()
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	db := DB.WithContext(ctx)
	result := db.Model(&model.AgentIdentityRejection{}).Where("ip = ? AND reason = ?", ip, reason).
		Updates(map[string]any{"last_report_at": now, "report_count": gorm.Expr("report_count + 1")})
	if result.Error != nil || result.RowsAffected > 0 {
		return
	}
	db.Exec(`INSERT INTO agent_identity_rejections (ip, reason, first_report_at, last_report_at, report_count)
        SELECT ?, ?, ?, ?, 1 WHERE (SELECT COUNT(*) FROM agent_identity_rejections) < 10000
        ON CONFLICT(ip, reason) DO UPDATE SET last_report_at = excluded.last_report_at, report_count = report_count + 1`,
		ip, reason, now, now)
}
