// Package logoasset stores validated logos as content-addressed, same-origin assets.
package logoasset

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/nezhahq/nezha/pkg/logofetch"
	_ "golang.org/x/image/webp"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

const Prefix = "/api/v1/logo/assets/"

var filename = regexp.MustCompile(`^[a-f0-9]{64}\.(png|jpg|webp|gif|ico|svg)$`)

func Name(src string) string {
	if !strings.HasPrefix(src, Prefix) {
		return ""
	}
	n := strings.TrimPrefix(src, Prefix)
	if !filename.MatchString(n) {
		return ""
	}
	return n
}
func Put(dir, src string) (string, error) {
	if n := Name(src); n != "" {
		s, e := os.Stat(filepath.Join(dir, n))
		if e != nil || !s.Mode().IsRegular() {
			return "", errors.New("已保存的图标文件不存在")
		}
		return src, nil
	}
	header, payload, ok := strings.Cut(src, ",")
	if !ok || !strings.HasPrefix(header, "data:image/") || !strings.HasSuffix(header, ";base64") {
		return "", errors.New("Logo 必须为有效的 PNG/JPEG/WebP/GIF 图片")
	}
	if e := os.MkdirAll(dir, 0700); e != nil {
		return "", e
	}
	f, e := os.CreateTemp(dir, ".upload-")
	if e != nil {
		return "", e
	}
	defer func() { f.Close(); os.Remove(f.Name()) }()
	hash := sha256.New()
	if _, e = io.Copy(io.MultiWriter(f, hash), base64.NewDecoder(base64.StdEncoding, strings.NewReader(payload))); e != nil {
		return "", errors.New("图片编码无效")
	}
	if _, e = f.Seek(0, 0); e != nil {
		return "", e
	}
	head := make([]byte, 512)
	n, _ := f.Read(head)
	mime := http.DetectContentType(head[:n])
	ext := map[string]string{"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/x-icon": "ico"}[mime]
	if ext == "" {
		f.Seek(0, 0)
		b, e := io.ReadAll(io.LimitReader(f, logofetch.MaxBody+1))
		if e != nil {
			return "", e
		}
		if _, _, e := logofetch.SVGSize(b); e != nil {
			return "", errors.New("不支持或不安全的图片格式")
		}
		ext = "svg"
	}
	f.Seek(0, 0)
	if ext == "ico" {
		b, e := io.ReadAll(io.LimitReader(f, logofetch.MaxBody+1))
		if e != nil || len(b) > logofetch.MaxBody || logofetch.InspectImage(b, "").Image == "" {
			return "", errors.New("无效 ICO 图标")
		}
	} else if ext != "svg" {
		cfg, _, e := image.DecodeConfig(f)
		if e != nil || cfg.Width < 1 || cfg.Height < 1 {
			return "", errors.New("无法解析图片")
		}
	}
	name := hex.EncodeToString(hash.Sum(nil)) + "." + ext
	if e = f.Close(); e != nil {
		return "", e
	}
	if e = os.Rename(f.Name(), filepath.Join(dir, name)); e != nil {
		return "", e
	}
	return Prefix + name, nil
}
func Import(ctx context.Context, dir, src string) (string, error) {
	if src == "" {
		return "", nil
	}
	if Name(src) != "" || strings.HasPrefix(src, "data:") {
		return Put(dir, src)
	}
	u, e := url.Parse(src)
	if e != nil || u.Scheme != "https" || u.User != nil {
		return "", errors.New("图片地址须为公开的 HTTPS 地址")
	}
	r, e := logofetch.Fetch(ctx, src, u.Path != "" && u.Path != "/")
	if e != nil {
		return "", e
	}
	return Put(dir, r.Image)
}

// ImportNote only modifies known logo fields; it preserves unrelated properties and numeric values.
func ImportNote(ctx context.Context, dir, raw string) (string, int, error) {
	var note map[string]any
	d := json.NewDecoder(strings.NewReader(raw))
	d.UseNumber()
	if d.Decode(&note) != nil || note == nil {
		return raw, 0, nil
	}
	if d.Decode(new(any)) != io.EOF {
		return raw, 0, nil
	}
	changes := 0
	for _, planKey := range []string{"planDataMod", "套餐信息"} {
		plan, ok := note[planKey].(map[string]any)
		if !ok {
			continue
		}
		var logos []map[string]any
		for _, key := range []string{"providerLogo", "厂商图标"} {
			if v, ok := plan[key].(map[string]any); ok {
				logos = append(logos, v)
			}
		}
		for _, key := range []string{"networkRouteLogos", "运营商图标"} {
			if rows, ok := plan[key].(map[string]any); ok {
				for _, v := range rows {
					if v, ok := v.(map[string]any); ok {
						logos = append(logos, v)
					}
				}
			}
		}
		for _, key := range []string{"networkRouteEntries", "其他运营商线路"} {
			if rows, ok := plan[key].([]any); ok {
				for _, v := range rows {
					if v, ok := v.(map[string]any); ok {
						logos = append(logos, v)
					}
				}
			}
		}
		for _, logo := range logos {
			for _, key := range []string{"logo", "logoOriginal", "Logo地址", "原始Logo"} {
				src, ok := logo[key].(string)
				if !ok || src == "" {
					continue
				}
				if ctx.Err() != nil {
					return raw, 0, ctx.Err()
				}
				dst, e := Import(ctx, dir, src)
				if e != nil {
					return raw, 0, fmt.Errorf("图标保存失败，请重新获取或上传：%w", e)
				}
				if dst != src {
					logo[key] = dst
					changes++
					if (key == "logo" || key == "Logo地址") && strings.HasPrefix(src, "https://") && logo["logoWebsite"] == nil && logo["网站地址"] == nil {
						logo["logoWebsite"] = src
					}
				}
			}
		}
	}
	if changes == 0 {
		return raw, 0, nil
	}
	b, e := json.Marshal(note)
	return string(b), changes, e
}
