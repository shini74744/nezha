package controller

import (
	"fmt"
	"regexp"
)

var greetingTimePattern = regexp.MustCompile(`^([01][0-9]|2[0-3]):[0-5][0-9]$`)
var clockColorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// Fields absent in older documents retain the embedded frontend defaults.
func validateGreetingClockFields(key string, feature map[string]any) error {
	if key == "greeting" {
		if rules, exists := feature["rules"]; exists {
			list, ok := rules.([]any)
			if !ok || len(list) > 32 {
				return fmt.Errorf("greeting.rules must contain at most 32 periods")
			}
			for _, raw := range list {
				rule, ok := raw.(map[string]any)
				if !ok {
					return fmt.Errorf("invalid greeting period")
				}
				for _, field := range []string{"start", "end"} {
					value, ok := rule[field].(string)
					if !ok || !greetingTimePattern.MatchString(value) {
						return fmt.Errorf("greeting.%s must use HH:mm", field)
					}
				}
			}
		}
	}
	if key == "clock" {
		for _, field := range []string{"hourStartColor", "hourEndColor", "minuteStartColor", "minuteEndColor", "secondStartColor", "secondEndColor"} {
			if raw, exists := feature[field]; exists {
				value, ok := raw.(string)
				if !ok || !clockColorPattern.MatchString(value) {
					return fmt.Errorf("clock.%s must use #RRGGBB", field)
				}
			}
		}
	}
	return nil
}
