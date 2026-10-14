package controller

import (
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"strings"
	"time"
)

type UUIDBlacklistRecord struct {
	UUID           string    `json:"uuid"`
	Name           string    `json:"name"`
	OriginalID     uint64    `json:"original_id"`
	CreatedAt      time.Time `json:"created_at" gorm:"-"`
	CreatedAtUnix  int64     `json:"-"`
	BlockVersion   uint64    `json:"block_version"`
	ReleasedAt     int64     `json:"released_at"`
	ReleasedByName string    `json:"released_by_name"`
	Kind           string    `json:"kind"`
}

func listUUIDBlacklist(c *gin.Context) (*model.Value[[]UUIDBlacklistRecord], error) {
	limit, offset := operationPage(c)
	// Deleted identities take precedence. Rejected pairs do not block other,
	// correctly registered pairs with the same UUID.
	union := `SELECT uuid,name,original_id,CAST(strftime('%s',created_at) AS INTEGER) AS created_at_unix,block_version,released_at,released_by_name,'deleted' AS kind
 FROM server_deletion_tombstones
 UNION ALL
 SELECT r.uuid,COALESCE(s.name,''),COALESCE(s.id,0),MIN(r.first_report_at),0,
 CASE WHEN MIN(r.accepted_at)=0 THEN 0 ELSE MAX(r.accepted_at) END,'','rejected'
 FROM agent_credential_rejections r LEFT JOIN servers s ON s.uuid=r.uuid
 WHERE r.uuid<>'' AND NOT EXISTS (SELECT 1 FROM server_deletion_tombstones d WHERE d.uuid=r.uuid)
 GROUP BY r.uuid,s.name,s.id`
	query := singleton.DB.Table("(" + union + ") AS records")
	switch c.Query("status") {
	case "", "all":
	case "blocked":
		query = query.Where("released_at = 0")
	case "released":
		query = query.Where("released_at <> 0")
	default:
		return nil, errors.New("未知状态")
	}
	if q := strings.TrimSpace(c.Query("q")); q != "" {
		if len(q) > 128 {
			return nil, errors.New("搜索内容过长")
		}
		query = query.Where("instr(lower(name),lower(?))>0 OR instr(lower(uuid),lower(?))>0 OR CAST(original_id AS TEXT)=?", q, q, q)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, err
	}
	rows := make([]UUIDBlacklistRecord, 0)
	if err := query.Order("created_at_unix DESC,uuid ASC").Limit(limit).Offset(offset).Scan(&rows).Error; err != nil {
		return nil, err
	}
	for i := range rows {
		rows[i].CreatedAt = time.Unix(rows[i].CreatedAtUnix, 0)
	}
	c.Header("Cache-Control", "no-store")
	return &model.Value[[]UUIDBlacklistRecord]{Value: rows, Pagination: model.Pagination{Total: total, Offset: offset, Limit: limit}}, nil
}
