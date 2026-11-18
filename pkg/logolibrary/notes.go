package logolibrary

import (
	"encoding/json"
	"github.com/nezhahq/nezha/model"
	"io"
	"strings"
)

func RewriteNote(raw string, entries map[string]model.LogoLibraryEntry, onlyID string, detach bool) (string, error) {
	var n map[string]any
	d := json.NewDecoder(strings.NewReader(raw))
	d.UseNumber()
	if d.Decode(&n) != nil || n == nil || d.Decode(new(any)) != io.EOF {
		return raw, nil
	}
	changed := false
	for _, v := range noteLogoObjects(n) {
		id := field(v, "logoLibraryId", "图标库ID")
		if id == "" || (onlyID != "" && id != onlyID) {
			continue
		}
		entry, ok := entries[id]
		if !ok {
			continue
		}
		values := map[string]string{"logo": entry.Logo, "logoOriginal": entry.LogoOriginal, "logoWebsite": entry.LogoWebsite, "logoLibraryName": entry.Name, "logoBackground": entry.Background}
		aliases := map[string]string{"logo": "Logo地址", "logoOriginal": "原始Logo", "logoWebsite": "网站地址", "logoLibraryName": "图标名称", "logoBackground": "图标底色"}
		_, chinese := v["图标库ID"]
		for k, value := range values {
			key := k
			if chinese {
				key = aliases[k]
			}
			if v[key] != value {
				v[key] = value
				changed = true
			}
		}
		if detach {
			delete(v, "logoLibraryId")
			delete(v, "图标库ID")
			changed = true
		}
	}
	if !changed {
		return raw, nil
	}
	b, e := json.Marshal(n)
	return string(b), e
}

// ReferencedIDs uses exactly the same supported note fields as snapshot updates.
// Repeated references within a server count only once.
func ReferencedIDs(raw string) []string {
	var n map[string]any
	d := json.NewDecoder(strings.NewReader(raw))
	d.UseNumber()
	if d.Decode(&n) != nil || n == nil || d.Decode(new(any)) != io.EOF {
		return nil
	}
	seen := make(map[string]bool)
	var ids []string
	for _, v := range noteLogoObjects(n) {
		id := field(v, "logoLibraryId", "图标库ID")
		if id != "" && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	return ids
}
func noteLogoObjects(n map[string]any) []map[string]any {
	var objects []map[string]any
	for _, pk := range []string{"planDataMod", "套餐信息"} {
		p, _ := n[pk].(map[string]any)
		if p == nil {
			continue
		}
		for _, k := range []string{"providerLogo", "厂商图标"} {
			if v, ok := p[k].(map[string]any); ok {
				objects = append(objects, v)
			}
		}
		for _, k := range []string{"networkRouteLogos", "运营商图标"} {
			if rows, ok := p[k].(map[string]any); ok {
				for _, r := range rows {
					if v, ok := r.(map[string]any); ok {
						objects = append(objects, v)
					}
				}
			}
		}
		for _, k := range []string{"networkRouteEntries", "其他运营商线路"} {
			if rows, ok := p[k].([]any); ok {
				for _, r := range rows {
					if v, ok := r.(map[string]any); ok {
						objects = append(objects, v)
					}
				}
			}
		}

	}
	return objects
}
