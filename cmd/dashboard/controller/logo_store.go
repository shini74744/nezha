package controller

import (
	"context"
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/pkg/logoasset"
	"net/http"
	"path/filepath"
	"strings"
	"time"
)

const logoDirectory = "data/logos"

func storeWebsiteLogo(c *gin.Context) (any, error) {
	select {
	case logoFetchSlots <- struct{}{}:
		defer func() { <-logoFetchSlots }()
	default:
		return nil, errors.New("正在保存其他图标，请稍后再试")
	}
	var form struct {
		Logo     string `json:"logo"`
		Original string `json:"logoOriginal"`
	}
	if e := c.ShouldBindJSON(&form); e != nil {
		return nil, errors.New("图片数据无效")
	}
	logo, e := logoasset.Put(logoDirectory, form.Logo)
	if e != nil {
		return nil, e
	}
	original := ""
	if form.Original != "" {
		original, e = logoasset.Put(logoDirectory, form.Original)
		if e != nil {
			return nil, e
		}
	}
	return gin.H{"logo": logo, "logoOriginal": original}, nil
}
func serveLogoAsset(c *gin.Context) {
	name := logoasset.Name(logoasset.Prefix + c.Param("name"))
	if name == "" {
		c.Status(http.StatusNotFound)
		return
	}
	mime := map[string]string{"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp", "gif": "image/gif", "ico": "image/x-icon", "svg": "image/svg+xml"}[strings.TrimPrefix(filepath.Ext(name), ".")]
	c.Header("Content-Type", mime)
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
	c.Header("Cache-Control", "public, max-age=31536000, immutable")
	c.Header("ETag", `"`+name+`"`)
	c.File(filepath.Join(logoDirectory, name))
}
func importServerLogos(c *gin.Context, raw string) (string, error) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 35*time.Second)
	defer cancel()
	select {
	case logoFetchSlots <- struct{}{}:
		defer func() { <-logoFetchSlots }()
	default:
		return "", errors.New("正在保存其他图标，请稍后重试")
	}
	note, _, e := logoasset.ImportNote(ctx, logoDirectory, raw)
	return note, e
}
