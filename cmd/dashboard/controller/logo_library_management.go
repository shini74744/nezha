package controller

import (
	"errors"

	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/logolibrary"
	"github.com/nezhahq/nezha/service/singleton"
	"gorm.io/gorm"
)

type logoUsageServer struct {
	ID   uint64 `json:"id"`
	Name string `json:"name"`
}

func listLogoUsage(c *gin.Context) (any, error) {
	// Select only the public fields needed to resolve references. Never return notes,
	// addresses, credentials or other fields of the server model.
	var rows []struct {
		ID         uint64
		Name       string
		PublicNote string
	}
	if err := singleton.DB.WithContext(c.Request.Context()).Model(&model.Server{}).Select("id, name, public_note").Order("id").Find(&rows).Error; err != nil {
		return nil, err
	}
	usage := map[string][]logoUsageServer{}
	for _, row := range rows {
		for _, id := range logolibrary.ReferencedIDs(row.PublicNote) {
			usage[id] = append(usage[id], logoUsageServer{row.ID, row.Name})
		}
	}
	return usage, nil
}

type logoGroupBatch struct {
	GroupID string `json:"group_id"`
	Entries []struct {
		ID      string `json:"id"`
		Version uint64 `json:"version"`
	} `json:"entries"`
}

func batchGroupLogos(c *gin.Context) (any, error) {
	var form logoGroupBatch
	if err := c.ShouldBindJSON(&form); err != nil {
		return nil, err
	}
	if len(form.Entries) == 0 || len(form.Entries) > 500 || len(form.GroupID) > 128 {
		return nil, errors.New("请选择 1–500 个厂商图标")
	}
	ids := make(map[string]bool, len(form.Entries))
	for _, e := range form.Entries {
		if e.ID == "" || len(e.ID) > 128 || e.Version == 0 || ids[e.ID] {
			return nil, errors.New("图标选择无效，请重新选择")
		}
		ids[e.ID] = true
	}
	logoLibraryMu.Lock()
	defer logoLibraryMu.Unlock()
	err := singleton.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		if err := validLogoGroup(tx, &model.LogoLibraryEntry{Kind: "provider", GroupID: form.GroupID}); err != nil {
			return err
		}
		for _, e := range form.Entries {
			result := tx.Model(&model.LogoLibraryEntry{}).Where("id = ? AND version = ? AND kind = ? AND deleted = ?", e.ID, e.Version, "provider", false).Updates(map[string]any{"group_id": form.GroupID, "version": gorm.Expr("version + 1")})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return errors.New("部分图标已变化，请刷新后重新选择；本次未修改任何图标")
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return gin.H{"updated": len(form.Entries)}, nil
}
