package controller

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

func validateBackgroundFields(f map[string]any) error {
	if value, ok := f["timezone"].(string); ok {
		if value == "" {
			return fmt.Errorf("background timezone is required")
		}
		if _, err := time.LoadLocation(value); err != nil {
			return fmt.Errorf("invalid background timezone")
		}
	}
	if value, ok := f["priority"].(string); ok && value != "region-first" && value != "schedule-first" {
		return fmt.Errorf("invalid background priority")
	}
	for _, key := range []string{"regionOrgPath", "regionCountryPath"} {
		if value, ok := f[key].(string); ok && !regexp.MustCompile("^[A-Za-z0-9_]+(\\.[A-Za-z0-9_]+)*$").MatchString(value) {
			return fmt.Errorf("invalid region field path")
		}
	}
	if f["regionEnabled"] == true && strings.TrimSpace(fmt.Sprint(f["regionApi"])) == "" {
		return fmt.Errorf("region API is required")
	}
	if rules, ok := f["scheduleRules"].([]any); ok {
		for _, raw := range rules {
			rule := raw.(map[string]any)
			for _, key := range []string{"start", "end"} {
				if !regexp.MustCompile("^([01][0-9]|2[0-3]):[0-5][0-9]$").MatchString(rule[key].(string)) {
					return fmt.Errorf("schedule time must be HH:mm")
				}
			}
			if rule["enabled"] == true && len(rule["desktopMedia"].([]any)) == 0 && len(rule["mobileMedia"].([]any)) == 0 {
				return fmt.Errorf("enabled schedule requires media")
			}
		}
	}
	return nil
}
