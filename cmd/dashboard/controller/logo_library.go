package controller

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/logoasset"
	"github.com/nezhahq/nezha/pkg/logolibrary"
	"github.com/nezhahq/nezha/service/singleton"
	"gorm.io/gorm"
	"regexp"
	"strings"
	"sync"
	"time"
)

var logoLibraryMu sync.Mutex

func listLogoLibrary(c *gin.Context) (any, error) {
	var entries []model.LogoLibraryEntry
	e := singleton.DB.Where("deleted = ?", false).Order("kind, name, id").Find(&entries).Error
	return entries, e
}
func normalizeLibraryEntry(c *gin.Context, v *model.LogoLibraryEntry) error {
	select {
	case logoFetchSlots <- struct{}{}:
		defer func() { <-logoFetchSlots }()
	default:
		return errors.New("正在保存其他图标，请稍后重试")
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 35*time.Second)
	defer cancel()
	if v.Regions == nil {
		v.Regions = []string{}
	}
	v.Name = strings.TrimSpace(v.Name)
	v.Aliases = strings.TrimSpace(v.Aliases)
	if v.Name == "" || len([]rune(v.Name)) > 120 {
		return errors.New("图标名称必填，最多 120 个字符")
	}
	if v.Kind != "provider" && v.Kind != "carrier" {
		return errors.New("图标分类无效")
	}
	if len(v.Regions) > 32 || len(v.Aliases) > 2000 || len(v.LogoWebsite) > 2048 {
		return errors.New("图标设置过长")
	}
	for _, region := range v.Regions {
		if !regexp.MustCompile(`^([A-Z]{2}|INT)$`).MatchString(region) {
			return errors.New("国家/地区无效")
		}
	}
	if v.Background != "" && !regexp.MustCompile(`^#[a-fA-F0-9]{6}$`).MatchString(v.Background) {
		return errors.New("图标底色无效")
	}
	var e error
	if v.Logo != "" {
		v.Logo, e = logoasset.Import(ctx, logoDirectory, v.Logo)
		if e != nil {
			return e
		}
	}
	if v.LogoOriginal != "" {
		v.LogoOriginal, e = logoasset.Import(ctx, logoDirectory, v.LogoOriginal)
		if e != nil {
			return e
		}
	}
	return nil
}
func createLogoLibrary(c *gin.Context) (any, error) {
	var v model.LogoLibraryEntry
	if e := c.ShouldBindJSON(&v); e != nil {
		return nil, e
	}
	if e := normalizeLibraryEntry(c, &v); e != nil {
		return nil, e
	}
	v.ID = v.Kind + "-" + strings.ToLower(rand.Text())
	v.Builtin = false
	v.Deleted = false
	v.Version = 1
	logoLibraryMu.Lock()
	defer logoLibraryMu.Unlock()
	return &v, singleton.DB.Create(&v).Error
}
func updateLogoLibrary(c *gin.Context) (any, error) {
	var form model.LogoLibraryEntry
	if e := c.ShouldBindJSON(&form); e != nil {
		return nil, e
	}
	if e := normalizeLibraryEntry(c, &form); e != nil {
		return nil, e
	}
	return changeLogoLibrary(c, &form, false)
}
func deleteLogoLibrary(c *gin.Context) (any, error) {
	var form struct {
		Version uint64 `form:"version"`
	}
	if e := c.ShouldBindQuery(&form); e != nil {
		return nil, e
	}
	return changeLogoLibrary(c, &model.LogoLibraryEntry{Version: form.Version}, true)
}
func changeLogoLibrary(c *gin.Context, form *model.LogoLibraryEntry, remove bool) (any, error) {
	logoLibraryMu.Lock()
	defer logoLibraryMu.Unlock()
	if singleton.ServerIDReassignmentInProgress.Load() {
		return nil, errors.New("服务器 ID 正在调整，请稍后重试")
	}
	var changed []model.Server
	var saved model.LogoLibraryEntry
	e := singleton.DB.Transaction(func(tx *gorm.DB) error {
		var old model.LogoLibraryEntry
		if e := tx.Where("id = ? AND deleted = ?", c.Param("id"), false).First(&old).Error; e != nil {
			return errors.New("图标不存在或已删除")
		}
		if form.Version != old.Version {
			return errors.New("图标已被修改，请刷新后重试")
		}
		saved = old
		if remove {
			saved.Deleted = true
		} else {
			if form.Kind != old.Kind {
				return errors.New("不能改变图标分类")
			}
			saved.Name = form.Name
			saved.Regions = form.Regions
			saved.Aliases = form.Aliases
			saved.Logo = form.Logo
			saved.LogoOriginal = form.LogoOriginal
			saved.LogoWebsite = form.LogoWebsite
			saved.Background = form.Background
		}
		saved.Version++
		if e := tx.Save(&saved).Error; e != nil {
			return e
		}
		var servers []model.Server
		if e := tx.Find(&servers).Error; e != nil {
			return e
		}
		for _, s := range servers {
			raw, e := logolibrary.RewriteNote(s.PublicNote, map[string]model.LogoLibraryEntry{saved.ID: saved}, saved.ID, remove)
			if e != nil {
				return e
			}
			if raw == s.PublicNote {
				continue
			}
			r := tx.Model(&model.Server{}).Where("id = ? AND public_note = ?", s.ID, s.PublicNote).Update("public_note", raw)
			if r.Error != nil {
				return r.Error
			}
			if r.RowsAffected != 1 {
				return errors.New("服务器备注已变化，请重试")
			}
			s.PublicNote = raw
			changed = append(changed, s)
		}
		return nil
	})
	if e != nil {
		return nil, e
	}
	if singleton.ServerShared != nil {
		for i := range changed {
			if old, ok := singleton.ServerShared.Get(changed[i].ID); ok && old != nil {
				changed[i].CopyFromRunningServer(old)
				singleton.ServerShared.Update(&changed[i], "")
			}
		}
	}
	return gin.H{"entry": saved, "updated_servers": len(changed)}, nil
}
func resolveLogoLibrary(raw string) (string, error) {
	if !strings.Contains(raw, "logoLibraryId") && !strings.Contains(raw, "图标库ID") {
		return raw, nil
	}
	var entries []model.LogoLibraryEntry
	if e := singleton.DB.Where("deleted = ?", false).Find(&entries).Error; e != nil {
		return "", fmt.Errorf("读取图标库失败: %w", e)
	}
	byID := map[string]model.LogoLibraryEntry{}
	for _, v := range entries {
		byID[v.ID] = v
	}
	return logolibrary.RewriteNote(raw, byID, "", false)
}
