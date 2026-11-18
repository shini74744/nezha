package controller

import (
	"fmt"
	"math"
	"regexp"
	"strings"
	"unicode/utf8"
)

var appearanceFontID = regexp.MustCompile("^[a-zA-Z0-9_-]{1,64}$")
var appearanceHexColor = regexp.MustCompile("^#[0-9a-fA-F]{6}$")
var appearanceFontBuiltins = map[string]bool{"douyin": true, "harmony": true, "oppo": true, "misans": true, "bytedance": true, "noto": true, "lxgw": true, "system": true}

func validateAppearanceOptionsFields(key string, supplied, defaults map[string]any) error {
	f := make(map[string]any, len(defaults))
	for k, v := range defaults {
		f[k] = v
	}
	for k, v := range supplied {
		f[k] = v
	}
	switch key {
	case "font":
		items, ok := f["items"].([]any)
		if !ok || len(items) < 1 || len(items) > 32 {
			return fmt.Errorf("font must contain 1-32 items")
		}
		ids := map[string]bool{}
		for _, raw := range items {
			item := raw.(map[string]any)
			id := item["id"].(string)
			if !appearanceFontID.MatchString(id) || id == "random" || ids[id] {
				return fmt.Errorf("invalid or duplicate font ID")
			}
			ids[id] = true
			for name, max := range map[string]int{"name": 80, "family": 128} {
				v := item[name].(string)
				if strings.TrimSpace(v) == "" || utf8.RuneCountInString(v) > max {
					return fmt.Errorf("invalid font %s", name)
				}
			}
			for _, r := range item["family"].(string) {
				if r < 32 {
					return fmt.Errorf("invalid font family")
				}
			}
			source := item["source"].(string)
			builtin := item["builtin"].(string)
			if source != "builtin" && source != "file" && source != "local" {
				return fmt.Errorf("invalid font source")
			}
			if builtin != "" && !appearanceFontBuiltins[builtin] {
				return fmt.Errorf("invalid built-in font")
			}
			if source == "builtin" && builtin == "" {
				return fmt.Errorf("built-in font required")
			}
			if source == "file" && strings.TrimSpace(item["url"].(string)) == "" {
				return fmt.Errorf("font file URL required")
			}
			format := item["format"].(string)
			if format != "woff2" && format != "woff" && format != "truetype" && format != "opentype" {
				return fmt.Errorf("invalid font format")
			}
		}
		active := f["activeId"].(string)
		if active != "random" && !ids[active] {
			return fmt.Errorf("selected font does not exist")
		}
	case "heart":
		if !appearanceHexColor.MatchString(f["fixedColor"].(string)) {
			return fmt.Errorf("invalid heart color")
		}
	case "stars":
		colors := f["palette"].([]any)
		if len(colors) < 1 || len(colors) > 8 {
			return fmt.Errorf("stars require 1-8 colors")
		}
		for _, c := range colors {
			if !appearanceHexColor.MatchString(c.(string)) {
				return fmt.Errorf("invalid star color")
			}
		}
	case "links":
		for _, name := range []string{"textColor", "hoverColor", "loginColor"} {
			c := f[name].(string)
			if c != "" && !appearanceHexColor.MatchString(c) {
				return fmt.Errorf("invalid link color")
			}
		}
	}
	if key == "heart" || key == "stars" || key == "sakura" || key == "links" {
		for _, name := range []string{"size", "duration", "interval", "distance", "spread", "fontSize", "gap", "hoverLift"} {
			if n, ok := f[name].(float64); ok && math.Trunc(n) != n {
				return fmt.Errorf("%s must be an integer", name)
			}
		}
	}
	return nil
}
