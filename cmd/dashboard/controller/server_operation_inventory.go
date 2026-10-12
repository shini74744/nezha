package controller

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
)

// Group by immutable UUID. Current inventory drives ordering; removed nodes
// remain discoverable after it. SQL grouping happens BEFORE pagination.
type operationServer struct {
	ServerUUID string `json:"server_uuid"`
	ServerID   uint64 `json:"server_id"`
	ServerName string `json:"server_name"`
	Position   int    `json:"position"`
	Deleted    bool   `json:"deleted"`
	Count      int64  `json:"count"`
	LastID     uint64 `json:"last_id"`
	LastAt     int64  `json:"last_at"`
}

func listOperationServers(c *gin.Context) (*model.Value[[]operationServer], error) {
	limit, offset := operationPage(c)
	query := strings.TrimSpace(c.Query("q"))
	if len([]rune(query)) > 200 {
		query = string([]rune(query)[:200])
	}
	q := "%" + strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_").Replace(query) + "%"
	action := c.Query("action")
	fields, fieldErr := operationFields(c.Query("field"))
	if fieldErr != nil {
		return nil, fieldErr
	}
	fieldCondition := ""
	if len(fields) > 0 {
		fieldCondition = " AND " + operationFieldSQL
	}
	id, idErr := strconv.ParseInt(query, 10, 64)
	if idErr != nil || id <= 0 {
		id = -1
	}
	// Historical ID/name search remains available without changing each card's
	// current name, current system ID, and current display position.
	cte := `WITH current_servers AS (
 SELECT id, uuid, name, ROW_NUMBER() OVER (ORDER BY display_index DESC, id ASC) AS position FROM servers
 ), identities AS (
 SELECT uuid FROM servers UNION SELECT server_uuid FROM server_operation_logs
 ), filtered AS (
 SELECT * FROM server_operation_logs WHERE (? = '' OR action = ?)` + fieldCondition + `
 ), cards AS (
 SELECT i.uuid AS server_uuid,
 COALESCE(s.id, last.server_id, 0) AS server_id,
 COALESCE(s.name, last.server_name, '') AS server_name,
 COALESCE(s.position, 0) AS position, s.id IS NULL AS deleted,
 (SELECT COUNT(*) FROM filtered f WHERE f.server_uuid = i.uuid) AS count,
 COALESCE((SELECT MAX(id) FROM filtered f WHERE f.server_uuid = i.uuid),0) AS last_id,
 COALESCE((SELECT CAST(strftime('%s',created_at) AS INTEGER)*1000 FROM filtered f WHERE f.server_uuid = i.uuid ORDER BY id DESC LIMIT 1),0) AS last_at
 FROM identities i LEFT JOIN current_servers s ON s.uuid = i.uuid
 LEFT JOIN server_operation_logs last ON last.id = (SELECT MAX(id) FROM server_operation_logs l WHERE l.server_uuid = i.uuid)
 WHERE i.uuid <> ''
 AND (? = '' OR EXISTS (SELECT 1 FROM filtered f WHERE f.server_uuid = i.uuid))
 AND (? = '' OR s.name LIKE ? ESCAPE '\' OR i.uuid = ? OR s.id = ?
 OR EXISTS (SELECT 1 FROM server_operation_logs h WHERE h.server_uuid = i.uuid
 AND (h.server_name LIKE ? ESCAPE '\' OR h.server_id = ? OR h.previous_id = ?)))
 ) `
	args := []any{action, action}
	if len(fields) > 0 {
		args = append(args, fields)
	}
	filterActive := action + c.Query("field")
	args = append(args, filterActive, query, q, query, id, q, id, id)
	var total int64
	if err := singleton.DB.Raw(cte+"SELECT COUNT(*) FROM cards", args...).Scan(&total).Error; err != nil {
		return nil, err
	}
	rows := make([]operationServer, 0)
	paging := append(append([]any(nil), args...), limit, offset)
	if err := singleton.DB.Raw(cte+"SELECT * FROM cards ORDER BY deleted ASC, position ASC, last_id DESC, server_uuid ASC LIMIT ? OFFSET ?", paging...).Scan(&rows).Error; err != nil {
		return nil, err
	}
	return &model.Value[[]operationServer]{Value: rows, Pagination: model.Pagination{Total: total, Offset: offset, Limit: limit}}, nil
}

func deleteServerOperationHistory(c *gin.Context) (uint64, error) {
	var request struct {
		UUID      string `json:"uuid" binding:"required"`
		ID        uint64 `json:"id"`
		ThroughID uint64 `json:"through_id"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		return 0, err
	}
	if request.ID == 0 && request.ThroughID == 0 {
		return 0, fmt.Errorf("必须指定记录或已确认的历史范围")
	}
	singleton.ServerMutationMu.Lock()
	defer singleton.ServerMutationMu.Unlock()
	query := singleton.DB.Where("server_uuid = ?", request.UUID)
	if request.ID != 0 {
		query = query.Where("id = ?", request.ID)
	} else {
		query = query.Where("id <= ?", request.ThroughID)
	}
	result := query.Delete(&model.ServerOperationLog{})
	// Never delete inventory baseline, live node, monitoring data or newer events.
	return uint64(result.RowsAffected), result.Error
}
