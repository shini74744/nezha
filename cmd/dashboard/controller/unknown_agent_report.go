package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
)

// Deletion history, credential failures and concurrent-stream warnings remain
// distinct. A warning is not a failed authentication or a verified new machine.
func listUnknownAgentReports(c *gin.Context) (*model.Value[[]model.UnknownAgentReportView], error) {
	limit, offset := operationPage(c)
	union := `SELECT uuid, name, 'deleted' AS kind, last_ip, '' AS previous_ip,
        '' AS previous_peer, '' AS last_peer, first_report_at, last_report_at, report_count
        FROM server_deletion_tombstones WHERE report_count > 0
        UNION ALL
        SELECT u.uuid, COALESCE(s.name, '') AS name,
        CASE WHEN s.id IS NULL THEN 'unregistered' ELSE 'registered' END AS kind,
        u.last_ip, '', '', '', u.first_report_at, u.last_report_at, u.report_count
        FROM unknown_agent_reports AS u LEFT JOIN servers AS s ON s.uuid = u.uuid
        WHERE NOT EXISTS (SELECT 1 FROM server_deletion_tombstones AS d WHERE d.uuid = u.uuid)
        UNION ALL
        SELECT c.uuid, s.name, 'conflict', c.last_ip, c.previous_ip, c.previous_peer, c.last_peer,
        c.first_report_at, c.last_report_at, c.report_count
        FROM agent_uuid_conflicts AS c JOIN servers AS s ON s.uuid = c.uuid
        WHERE NOT EXISTS (SELECT 1 FROM server_deletion_tombstones AS d WHERE d.uuid = c.uuid)
        UNION ALL
        SELECT '', '未识别节点', r.reason, r.ip, '', '', '',
        r.first_report_at, r.last_report_at, r.report_count
        FROM agent_identity_rejections AS r`
	query := singleton.DB.Table("(" + union + ") AS reports")
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, err
	}
	rows := make([]model.UnknownAgentReportView, 0)
	if err := query.Order("last_report_at DESC, uuid ASC, kind ASC, last_ip ASC").Limit(limit).Offset(offset).Scan(&rows).Error; err != nil {
		return nil, err
	}
	return &model.Value[[]model.UnknownAgentReportView]{Value: rows, Pagination: model.Pagination{Total: total, Offset: offset, Limit: limit}}, nil
}
