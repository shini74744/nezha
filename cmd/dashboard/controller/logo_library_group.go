package controller

import (
	"crypto/rand"
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"gorm.io/gorm"
	"strings"
)

func listLogoGroups(c *gin.Context) (any, error) {
	var groups []model.LogoLibraryGroup
	err := singleton.DB.Order("name, id").Find(&groups).Error
	return groups, err
}
func validLogoGroup(tx *gorm.DB, entry *model.LogoLibraryEntry) error {
	if entry.GroupID == "" {
		return nil
	}
	if entry.Kind != "provider" {
		return errors.New("只有厂商图标可以分组")
	}
	var count int64
	if err := tx.Model(&model.LogoLibraryGroup{}).Where("id = ?", entry.GroupID).Count(&count).Error; err != nil {
		return err
	}
	if count != 1 {
		return errors.New("分组不存在，请刷新后重试")
	}
	return nil
}
func saveLogoGroup(c *gin.Context) (any, error) {
	var form model.LogoLibraryGroup
	if err := c.ShouldBindJSON(&form); err != nil {
		return nil, err
	}
	form.Name = strings.TrimSpace(form.Name)
	if form.Name == "" || len([]rune(form.Name)) > 60 {
		return nil, errors.New("分组名称必填，最多 60 个字符")
	}
	logoLibraryMu.Lock()
	defer logoLibraryMu.Unlock()
	if c.Param("id") == "" {
		form.ID = "group-" + strings.ToLower(rand.Text())
		form.Version = 1
		err := singleton.DB.Create(&form).Error
		if err != nil {
			return nil, errors.New("分组创建失败，名称可能已存在")
		}
		return form, nil
	}
	var saved model.LogoLibraryGroup
	err := singleton.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&saved, "id = ?", c.Param("id")).Error; err != nil {
			return errors.New("分组不存在")
		}
		if saved.Version != form.Version {
			return errors.New("分组已变化，请刷新后重试")
		}
		saved.Name = form.Name
		saved.Version++
		return tx.Save(&saved).Error
	})
	return saved, err
}
func deleteLogoGroup(c *gin.Context) (any, error) {
	var form struct {
		Version uint64 `form:"version"`
	}
	if err := c.ShouldBindQuery(&form); err != nil {
		return nil, err
	}
	logoLibraryMu.Lock()
	defer logoLibraryMu.Unlock()
	err := singleton.DB.Transaction(func(tx *gorm.DB) error {
		var group model.LogoLibraryGroup
		if err := tx.First(&group, "id = ?", c.Param("id")).Error; err != nil {
			return errors.New("分组不存在")
		}
		if group.Version != form.Version {
			return errors.New("分组已变化，请刷新后重试")
		}
		if err := tx.Model(&model.LogoLibraryEntry{}).Where("group_id = ?", group.ID).Updates(map[string]any{"group_id": "", "version": gorm.Expr("version + 1")}).Error; err != nil {
			return err
		}
		return tx.Delete(&group).Error
	})
	return nil, err
}
