package logolibrary

import (
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/logoasset"
	"gorm.io/gorm"
	"net/url"
	"strings"
)

//go:embed seed.json
var seedJSON []byte

func SeedEntries() ([]model.LogoLibraryEntry, error) {
	var entries []model.LogoLibraryEntry
	e := json.Unmarshal(seedJSON, &entries)
	return entries, e
}
func Seed(db *gorm.DB, dir string) error {
	var count int64
	if e := db.Model(&model.LogoLibraryEntry{}).Where("id = ?", "__seed-v1").Count(&count).Error; e != nil {
		return e
	}
	if count > 0 {
		return nil
	}
	entries, e := SeedEntries()
	if e != nil {
		return e
	}
	for i := range entries {
		if entries[i].Logo != "" {
			src, e := logoasset.Put(dir, entries[i].Logo)
			if e != nil {
				return fmt.Errorf("seed %s: %w", entries[i].ID, e)
			}
			entries[i].Logo = src
		}
	}
	var servers []model.Server
	if e := db.Select("id", "name", "public_note").Find(&servers).Error; e != nil {
		return e
	}
	seen := map[string]bool{}
	for i := range servers {
		s := &servers[i]
		var n map[string]any
		if json.Unmarshal([]byte(s.PublicNote), &n) != nil {
			continue
		}
		for _, pk := range []string{"planDataMod", "套餐信息"} {
			p, _ := n[pk].(map[string]any)
			for _, key := range []string{"providerLogo", "厂商图标"} {
				v, _ := p[key].(map[string]any)
				src := field(v, "logo", "Logo地址")
				if src == "" || seen[src] {
					continue
				}
				seen[src] = true
				local, e := logoasset.Import(context.Background(), dir, src)
				if e != nil {
					return e
				}
				original, e := logoasset.Import(context.Background(), dir, field(v, "logoOriginal", "原始Logo"))
				if e != nil {
					return e
				}
				site := field(v, "logoWebsite", "网站地址")
				name := s.Name + " 厂商"
				u, e := url.Parse(site)
				if e == nil && u.Hostname() == "" {
					u, e = url.Parse("https://" + site)
				}
				if e == nil && u.Hostname() != "" {
					name = strings.TrimPrefix(u.Hostname(), "www.")
				}
				sum := sha256.Sum256([]byte(src))
				entries = append(entries, model.LogoLibraryEntry{ID: "provider-import-" + hex.EncodeToString(sum[:8]), Kind: "provider", Name: name, Regions: []string{}, Logo: local, LogoOriginal: original, LogoWebsite: site, Version: 1})
			}
		}
	}
	return db.Transaction(func(tx *gorm.DB) error {
		for i := range entries {
			var c int64
			if e := tx.Model(&model.LogoLibraryEntry{}).Where("id = ?", entries[i].ID).Count(&c).Error; e != nil {
				return e
			}
			if c == 0 {
				if e := tx.Create(&entries[i]).Error; e != nil {
					return e
				}
			}
		}
		return tx.Create(&model.LogoLibraryEntry{ID: "__seed-v1", Deleted: true}).Error
	})
}
func field(v map[string]any, key, alias string) string {
	if s, ok := v[key].(string); ok {
		return s
	}
	s, _ := v[alias].(string)
	return s
}
