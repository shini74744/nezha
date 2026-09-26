package controller

import (
	"encoding/json"
	"fmt"
	appearance "github.com/nezhahq/nezha/resource/appearance"
	"math"
	"net/url"
	"regexp"
	"strings"
	"time"
)

type appearanceDefinition struct {
	Key         string
	Defaults    map[string]any
	Constraints map[string][]float64
}

var appearanceURLKey = regexp.MustCompile("(?i)(url|logo|illustration|^link$|^src$|images$|^regionApi$|^cdnPath$)")

func validateAppearanceFields(features map[string]map[string]any) error {
	var definitions []appearanceDefinition
	if err := json.Unmarshal(appearance.Manifest, &definitions); err != nil {
		return err
	}
	for _, definition := range definitions {
		feature, ok := features[definition.Key]
		if !ok {
			continue
		}
		if err := validateAppearanceValue(definition.Key, feature, definition.Defaults); err != nil {
			return err
		}
		if definition.Key == "background" {
			if err := validateBackgroundFields(feature); err != nil {
				return err
			}
		}
		for key, limits := range definition.Constraints {
			if value, ok := feature[key].(float64); ok && (value < limits[0] || value > limits[1]) {
				return fmt.Errorf("%s.%s is outside allowed range", definition.Key, key)
			}
		}
		if value, ok := feature["startDate"].(string); ok {
			if _, err := time.Parse(time.RFC3339, value); err != nil {
				return fmt.Errorf("runtime.startDate must include a valid timezone")
			}
		}
		if value, ok := feature["measurementId"].(string); ok && !regexp.MustCompile("^G-[A-Z0-9]+$").MatchString(value) {
			return fmt.Errorf("invalid analytics measurement ID")
		}
		if value, ok := feature["desktopTop"].(string); ok && !regexp.MustCompile("^-?[0-9]+(\\.[0-9]+)?(px|vh|rem|%)$").MatchString(value) {
			return fmt.Errorf("invalid sponsor position")
		}
		if value, ok := feature["color"].(string); ok {
			parts := strings.Split(value, ",")
			if len(parts) != 3 {
				return fmt.Errorf("invalid RGB color")
			}
			for _, part := range parts {
				var n int
				if !regexp.MustCompile("^[0-9]{1,3}$").MatchString(strings.TrimSpace(part)) {
					return fmt.Errorf("invalid RGB color")
				}
				fmt.Sscanf(strings.TrimSpace(part), "%d", &n)
				if n > 255 {
					return fmt.Errorf("RGB component exceeds 255")
				}
			}
		}
		if list, ok := feature["tools"].([]any); ok {
			allowed := map[string]bool{"hitokoto": true, "asteroids": true, "switch-model": true, "switch-texture": true, "photo": true, "info": true, "quit": true}
			for _, item := range list {
				if !allowed[item.(string)] {
					return fmt.Errorf("invalid Live2D tool")
				}
			}
		}
		for _, key := range []string{"count", "mobileCount", "selection", "nightStart", "nightEnd"} {
			if value, ok := feature[key].(float64); ok && math.Trunc(value) != value {
				return fmt.Errorf("%s must be an integer", key)
			}
		}
	}
	return nil
}
func validateAppearanceValue(key string, value, prototype any) error {
	switch expected := prototype.(type) {
	case map[string]any:
		object, ok := value.(map[string]any)
		if !ok {
			return fmt.Errorf("%s must be an object", key)
		}
		for name, item := range object {
			sample, exists := expected[name]
			if !exists {
				return fmt.Errorf("unknown field %s.%s", key, name)
			}
			if err := validateAppearanceValue(name, item, sample); err != nil {
				return err
			}
		}
	case []any:
		list, ok := value.([]any)
		if !ok || len(list) > 256 {
			return fmt.Errorf("%s must be a list of at most 256 items", key)
		}
		if len(expected) > 0 {
			for _, item := range list {
				if err := validateAppearanceValue(key, item, expected[0]); err != nil {
					return err
				}
				if sample, ok := expected[0].(map[string]any); ok {
					object := item.(map[string]any)
					for required := range sample {
						if _, ok := object[required]; !ok {
							return fmt.Errorf("%s item is missing %s", key, required)
						}
					}
				}
			}
		}
	case bool:
		if _, ok := value.(bool); !ok {
			return fmt.Errorf("%s must be boolean", key)
		}
	case float64:
		number, ok := value.(float64)
		if !ok || math.IsNaN(number) || math.IsInf(number, 0) || math.Abs(number) > 31536000000 {
			return fmt.Errorf("%s must be a finite number", key)
		}
	case string:
		text, ok := value.(string)
		if !ok || len(text) > 8192 || strings.ContainsRune(text, 0) {
			return fmt.Errorf("%s must be text of at most 8192 bytes", key)
		}
		if text != "" && key != "logoHeight" && appearanceURLKey.MatchString(key) {
			u, err := url.Parse(text)
			if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil {
				return fmt.Errorf("%s must be an HTTP/HTTPS address without credentials", key)
			}
		}
		if key == "type" && text != "image" && text != "video" && text != "auto" {
			return fmt.Errorf("background media type must be auto, image or video")
		}
	default:
		return fmt.Errorf("unsupported schema for %s", key)
	}
	return nil
}
