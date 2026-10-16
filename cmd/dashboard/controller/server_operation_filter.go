package controller

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"gorm.io/gorm"
)

func operationFields(value string) ([]string, error) {
	switch value {
	case "":
		return nil, nil
	case "cpu":
		return []string{"cpu"}, nil
	case "memory":
		return []string{"memory_total", "swap_total"}, nil
	case "disk":
		return []string{"disk_total"}, nil
	case "system":
		return []string{"operating_system", "architecture", "virtualization", "agent_version"}, nil
	case "ip":
		return []string{"ipv4", "ipv6"}, nil
	case "region":
		return []string{"region"}, nil
	case "gpu":
		return []string{"gpu"}, nil
	}
	return nil, fmt.Errorf("无效的记录分类")
}

const operationFieldSQL = "EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(changes) THEN changes ELSE '[]' END) item WHERE json_extract(item.value, '$.field') IN ?)"

func filterOperationFields(c *gin.Context, query *gorm.DB) (*gorm.DB, []string, error) {
	fields, err := operationFields(c.Query("field"))
	if err != nil {
		return nil, nil, err
	}
	if len(fields) > 0 {
		query = query.Where(operationFieldSQL, fields)
	}
	return query, fields, nil
}
func onlyOperationFields(rows []model.ServerOperationLog, fields []string) {
	if len(fields) == 0 {
		return
	}
	selected := map[string]bool{}
	for _, field := range fields {
		selected[field] = true
	}
	for i := range rows {
		changes := make([]model.ServerOperationChange, 0)
		for _, change := range rows[i].Changes {
			if selected[change.Field] {
				changes = append(changes, change)
			}
		}
		rows[i].Changes = changes
		if rows[i].Details != nil {
			details := *rows[i].Details
			if !selected["ipv4"] && !selected["ipv6"] {
				details.IPSnapshot = nil
			}
			if !selected["public_note"] {
				details.PublicNote = nil
			}
			rows[i].Details = &details
		}
	}
}
