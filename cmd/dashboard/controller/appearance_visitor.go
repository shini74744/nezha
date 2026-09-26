package controller

import (
	"fmt"
	"math"
	"strings"
)

func validateVisitorIPFields(f map[string]any) error {
	if value, ok := f["ipApiUrls"]; ok {
		urls := value.([]any)
		if len(urls) < 1 || len(urls) > 8 {
			return fmt.Errorf("visitorIP needs 1-8 IP APIs")
		}
		for _, raw := range urls {
			if strings.TrimSpace(raw.(string)) == "" {
				return fmt.Errorf("IP API cannot be empty")
			}
		}
	}
	if value, ok := f["checkNodes"]; ok {
		nodes := value.([]any)
		enabled, present := f["networkEnabled"].(bool)
		if len(nodes) > 16 || ((!present || enabled) && len(nodes) == 0) {
			return fmt.Errorf("enabled network detection needs 1-16 nodes")
		}
		names := map[string]bool{}
		for _, raw := range nodes {
			node := raw.(map[string]any)
			name := strings.TrimSpace(node["name"].(string))
			if name == "" || len([]rune(name)) > 64 || names[name] || strings.TrimSpace(node["url"].(string)) == "" {
				return fmt.Errorf("invalid or duplicate network node")
			}
			names[name] = true
		}
	}
	for _, key := range []string{"queryTimeout", "fallbackTimeout", "checkTimeout", "switchTimeout"} {
		if n, ok := f[key].(float64); ok && (math.Trunc(n) != n || n < 100 || n > 10000) {
			return fmt.Errorf("%s must be integer milliseconds in 100-10000", key)
		}
	}
	return nil
}
