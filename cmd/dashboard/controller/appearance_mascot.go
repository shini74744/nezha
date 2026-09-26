package controller

import (
	"fmt"
	"math"
	"net/url"
	"regexp"
	"strings"
	"unicode/utf8"
)

func validateMascotFields(f map[string]any) error {
	if v, ok := f["provider"].(string); ok && v != "live2d" && v != "sakana" {
		return fmt.Errorf("invalid mascot provider")
	}
	ids := map[string]bool{"chisato": true, "takina": true}
	if raw, exists := f["customCharacters"]; exists {
		list, ok := raw.([]any)
		if !ok || len(list) > 16 {
			return fmt.Errorf("customCharacters must contain at most 16 characters")
		}
		for _, rawRow := range list {
			row, ok := rawRow.(map[string]any)
			if !ok || len(row) < 3 || len(row) > 4 {
				return fmt.Errorf("invalid custom character fields")
			}
			for key := range row {
				if key != "id" && key != "name" && key != "imageUrl" && key != "scale" {
					return fmt.Errorf("invalid custom character field")
				}
			}
			if value, exists := row["scale"]; exists {
				scale, ok := value.(float64)
				if !ok || math.IsNaN(scale) || math.IsInf(scale, 0) || scale < 25 || scale > 200 {
					return fmt.Errorf("custom character scale must be 25-200")
				}
			}
			id, idOK := row["id"].(string)
			name, nameOK := row["name"].(string)
			image, imageOK := row["imageUrl"].(string)
			if !idOK || !nameOK || !imageOK || !regexp.MustCompile("^custom-[a-zA-Z0-9-]{1,64}$").MatchString(id) || ids[id] {
				return fmt.Errorf("invalid or duplicate custom character ID")
			}
			if strings.TrimSpace(name) == "" || utf8.RuneCountInString(name) > 60 || strings.ContainsRune(name, 0) {
				return fmt.Errorf("invalid character name")
			}
			u, err := url.Parse(image)
			if err != nil || len(image) > 2048 || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil {
				return fmt.Errorf("invalid character image URL")
			}
			ids[id] = true
		}
	}
	if v, ok := f["character"].(string); ok && !ids[v] {
		return fmt.Errorf("invalid Sakana character")
	}
	return nil
}
