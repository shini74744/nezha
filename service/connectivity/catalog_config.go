package connectivity

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/nezhahq/nezha/pkg/logoasset"
)

const MaxTargets = 120

type CatalogItem struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Group      string `json:"group"`
	URL        string `json:"url"`
	Icon       string `json:"icon"`
	IconSource string `json:"icon_source,omitempty"`
	Enabled    bool   `json:"enabled"`
}

func DefaultCatalog() []CatalogItem {
	out := make([]CatalogItem, len(targets))
	for i, t := range targets {
		out[i] = CatalogItem{ID: t.ID, Name: t.Name, Group: t.Group, URL: t.URL, Icon: t.ID, Enabled: true}
	}
	return out
}

var targetID = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)
var domainLabel = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`)
var domainTLD = regexp.MustCompile(`[a-z]`)

// Custom targets are administrator-owned HTTPS public-domain endpoints.
// Agents still resolve DNS themselves: this is input validation, not DNS pinning
// or a replacement for the Agent host's egress firewall.
func ValidateTargetURL(raw string) (string, error) {
	if len(raw) == 0 || len(raw) > 2048 || strings.TrimSpace(raw) != raw || strings.ContainsAny(raw, "\\\r\n\t") {
		return "", errors.New("检测地址须为 1–2048 字符的 HTTPS 公网域名链接")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Fragment != "" || u.Opaque != "" || u.Host == "" || (u.Port() != "" && u.Port() != "443") {
		return "", errors.New("仅支持 HTTPS/443，不允许用户凭据或片段")
	}
	host := strings.ToLower(u.Hostname())
	if net.ParseIP(host) != nil || strings.HasSuffix(host, ".") || len(host) > 253 {
		return "", errors.New("请使用公网域名，不支持 IP 地址")
	}
	labels := strings.Split(host, ".")
	if len(labels) < 2 || !domainTLD.MatchString(labels[len(labels)-1]) {
		return "", errors.New("请使用完整公网域名")
	}
	for _, label := range labels {
		if !domainLabel.MatchString(label) {
			return "", errors.New("域名格式不合法，请使用 ASCII/Punycode 域名")
		}
	}
	for _, suffix := range []string{"localhost", "local", "internal", "lan", "home", "test", "invalid", "onion"} {
		if host == suffix || strings.HasSuffix(host, "."+suffix) {
			return "", errors.New("不能使用本机或内部域名")
		}
	}
	return host, nil
}

func ValidateCatalog(items []CatalogItem) error {
	if items == nil || len(items) > MaxTargets {
		return fmt.Errorf("检测点列表不能为空值，最多 %d 项", MaxTargets)
	}
	seen := map[string]bool{}
	icons := map[string]bool{"": true}
	for _, t := range targets {
		icons[t.ID] = true
	}
	for _, item := range items {
		if !targetID.MatchString(item.ID) || seen[item.ID] {
			return errors.New("检测点 ID 无效或重复")
		}
		seen[item.ID] = true
		if strings.TrimSpace(item.Name) != item.Name || item.Name == "" || utf8.RuneCountInString(item.Name) > 60 || strings.ContainsFunc(item.Name, unicode.IsControl) {
			return errors.New("名称须为 1–60 字符，不能含控制字符")
		}
		switch item.Group {
		case "china", "japan", "usa", "global":
		default:
			return errors.New("检测点地区无效")
		}
		// Preserve shipped endpoints (including Cloudflare's fixed public IP).
		// This does not permit arbitrary new IP targets or edited built-in URLs.
		builtin, known := FindTarget(item.ID)
		if !known || item.URL != builtin.URL {
			if _, err := ValidateTargetURL(item.URL); err != nil {
				return fmt.Errorf("%s：%w", item.Name, err)
			}
		}
		if !icons[item.Icon] && logoasset.Name(item.Icon) == "" {
			return errors.New("请选择内置图标、默认图标或已导入的图片")
		}
		if item.IconSource != "" {
			u, err := url.Parse(item.IconSource)
			if logoasset.Name(item.Icon) == "" || err != nil || len(item.IconSource) > 2048 || strings.TrimSpace(item.IconSource) != item.IconSource || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Fragment != "" || (u.Port() != "" && u.Port() != "443") {
				return errors.New("自定义图标来源须为已导入的 HTTPS 图片地址")
			}
		}
	}
	return nil
}

func ParseCatalog(raw string) ([]CatalogItem, error) {
	if raw == "" {
		return DefaultCatalog(), nil
	}
	var items []CatalogItem
	if err := json.Unmarshal([]byte(raw), &items); err != nil {
		return nil, err
	}
	if err := ValidateCatalog(items); err != nil {
		return nil, err
	}
	return items, nil
}

func EnabledTargets(items []CatalogItem) []Target {
	out := make([]Target, 0, len(items))
	for _, item := range items {
		if !item.Enabled {
			continue
		}
		endpoint, _ := url.Parse(item.URL)
		host := endpoint.Hostname()
		out = append(out, Target{ID: item.ID, Name: item.Name, Group: item.Group, Host: host, URL: item.URL, Icon: item.Icon})
	}
	return out
}
