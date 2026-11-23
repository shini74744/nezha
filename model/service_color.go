package model

import (
	"fmt"
	"math"
	"regexp"
	"strings"

	"gorm.io/gorm"
)

var serviceColorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func NormalizeServiceColor(color string) (string, error) {
	color = strings.TrimSpace(color)
	if color == "" {
		return "", nil
	}
	if !serviceColorPattern.MatchString(color) {
		return "", fmt.Errorf("颜色应为 #RRGGBB 格式")
	}
	return strings.ToLower(color), nil
}

// AllocateServiceColor must run under ServiceMutationMu, or before writers start.
// Persist the result so reordering, restart and time-range changes never recolor a service.
func AllocateServiceColor(db *gorm.DB) (string, error) {
	var colors []string
	if err := db.Model(&Service{}).Pluck("chart_color", &colors).Error; err != nil {
		return "", err
	}
	used := make(map[string]bool, len(colors))
	for _, color := range colors {
		used[strings.ToLower(color)] = true
	}
	for n := 0; n < 1<<24; n++ {
		var color string
		if n < 4096 {
			hue := math.Mod(float64(n)*137.50776405003785+212, 360) / 60
			saturation := .65 - float64(n/64%3)*.08
			light := .43 + float64(n/192%3)*.06
			chroma := (1 - math.Abs(2*light-1)) * saturation
			x := chroma * (1 - math.Abs(math.Mod(hue, 2)-1))
			var r, g, b float64
			switch int(hue) {
			case 0:
				r, g = chroma, x
			case 1:
				r, g = x, chroma
			case 2:
				g, b = chroma, x
			case 3:
				g, b = x, chroma
			case 4:
				r, b = x, chroma
			default:
				r, b = chroma, x
			}
			m := light - chroma/2
			color = fmt.Sprintf("#%02x%02x%02x", int(math.Round((r+m)*255)), int(math.Round((g+m)*255)), int(math.Round((b+m)*255)))
		} else {
			color = fmt.Sprintf("#%06x", ((n-4096)*104729+0x396b9c)&0xffffff)
		}
		if !used[color] {
			return color, nil
		}
	}
	return "", fmt.Errorf("无可用的服务颜色")
}

func BackfillServiceColors(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		var rows []Service
		if err := tx.Where("chart_color IS NULL OR chart_color = ''").Order("id").Find(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			color, err := AllocateServiceColor(tx)
			if err != nil {
				return err
			}
			if err = tx.Model(&Service{}).Where("id = ?", row.ID).UpdateColumn("chart_color", color).Error; err != nil {
				return err
			}
		}
		return nil
	})
}
