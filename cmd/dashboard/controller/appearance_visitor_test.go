package controller

import (
	"encoding/json"
	appearance "github.com/nezhahq/nezha/resource/appearance"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestVisitorIPConfig(t *testing.T) {
	var definitions []appearanceDefinition
	require.NoError(t, json.Unmarshal(appearance.Manifest, &definitions))
	var defaults map[string]any
	for _, d := range definitions {
		if d.Key == "visitorIP" {
			defaults = d.Defaults
		}
	}
	check := func(f map[string]any) error {
		raw, _ := json.Marshal(map[string]any{"version": 1, "enabled": true, "features": map[string]any{"visitorIP": f}})
		_, err := validateAppearance(raw)
		return err
	}
	require.NoError(t, check(defaults))
	require.NoError(t, check(map[string]any{"enabled": true, "cacheDuration": 21600000, "bottomThreshold": 24}))
	for _, bad := range []map[string]any{
		{"ipApiUrls": []any{}}, {"ipApiUrls": []any{""}}, {"ipApiUrls": []any{"javascript:alert(1)"}},
		{"fallbackUrl": "https://user:secret@example.com"}, {"checkNodes": []any{}},
		{"checkNodes": []any{map[string]any{"name": "", "url": "https://example.com"}}},
		{"checkNodes": []any{map[string]any{"name": "a", "url": ""}}},
		{"checkNodes": []any{map[string]any{"name": "a", "url": "https://a.test"}, map[string]any{"name": " a ", "url": "https://b.test"}}},
		{"queryTimeout": 10001}, {"switchTimeout": 100.5}, {"showASN": "false"},
	} {
		f := map[string]any{"enabled": true}
		for k, v := range bad {
			f[k] = v
		}
		require.Error(t, check(f), "%v", bad)
	}
	require.NoError(t, check(map[string]any{"enabled": true, "networkEnabled": false, "checkNodes": []any{}, "fallbackUrl": "", "showASN": false}))
}
