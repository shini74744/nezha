package controller

import (
	"encoding/json"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestBackgroundPolicyValidation(t *testing.T) {
	valid := map[string]any{"enabled": true, "timezone": "Asia/Shanghai", "priority": "schedule-first", "regionEnabled": true, "regionApi": "https://example.test/ip", "regionOrgPath": "asn.org", "regionCountryPath": "data.country", "desktopMedia": []any{map[string]any{"type": "auto", "src": "https://example.test/media"}}, "scheduleRules": []any{map[string]any{"name": "night", "enabled": true, "start": "22:30", "end": "06:15", "desktopMedia": []any{map[string]any{"type": "video", "src": "https://example.test/a.mp4"}}, "mobileMedia": []any{}}}}
	validate := func(f map[string]any) error {
		raw, err := json.Marshal(map[string]any{"version": 1, "enabled": true, "features": map[string]any{"background": f}})
		require.NoError(t, err)
		_, err = validateAppearance(raw)
		return err
	}
	require.NoError(t, validate(valid))
	for key, value := range map[string]any{"timezone": "Bad/Timezone", "priority": "unknown", "regionOrgPath": "invalid path", "desktopMedia": []any{map[string]any{"type": "auto", "src": "javascript:alert(1)"}}} {
		t.Run(key, func(t *testing.T) {
			copy := map[string]any{}
			for k, v := range valid {
				copy[k] = v
			}
			copy[key] = value
			require.Error(t, validate(copy))
		})
	}
	rule := valid["scheduleRules"].([]any)[0].(map[string]any)
	rule["start"] = "24:00"
	require.Error(t, validate(valid))
	rule["start"] = "23:00"
	rule["desktopMedia"] = []any{}
	require.Error(t, validate(valid))
	rule["enabled"] = false
	require.NoError(t, validate(valid))
	require.NoError(t, validate(map[string]any{"enabled": true, "nightStart": 1, "nightEnd": 6, "nightEnabled": true, "nightImages": []any{"https://example.test/old.png"}}))
}

func TestBackgroundLoadSettings(t *testing.T) {
	check := func(f map[string]any) (json.RawMessage, error) {
		f["enabled"] = true
		raw, err := json.Marshal(map[string]any{"version": 1, "enabled": true, "features": map[string]any{"background": f}})
		require.NoError(t, err)
		result, err := validateAppearance(raw)
		return json.RawMessage(result), err
	}
	for _, effect := range []string{"center", "fade", "zoom", "top", "bottom", "left", "right", "none"} {
		_, err := check(map[string]any{"desktopLoadEffect": effect, "mobileLoadEffect": effect, "desktopLoadDuration": 0, "mobileLoadDuration": 10})
		require.NoError(t, err, effect)
	}
	for _, key := range []string{"desktopLoadEffect", "mobileLoadEffect"} {
		for _, invalid := range []any{"bad", "", nil, 1, []any{}} {
			_, err := check(map[string]any{key: invalid})
			require.Error(t, err, key)
		}
	}
	for _, key := range []string{"desktopLoadDuration", "mobileLoadDuration"} {
		for _, invalid := range []any{-1, 10.1, nil, "2"} {
			_, err := check(map[string]any{key: invalid})
			require.Error(t, err, key)
		}
	}
	f := map[string]any{"desktopLoadEffect": "left", "desktopLoadDuration": 4.5, "mobileLoadEffect": "zoom", "mobileLoadDuration": 0.8}
	result, err := check(f)
	require.NoError(t, err)
	var decoded struct {
		Features map[string]map[string]any `json:"features"`
	}
	require.NoError(t, json.Unmarshal(result, &decoded))
	require.Equal(t, f, decoded.Features["background"])
	_, err = check(map[string]any{"enabled": true})
	require.NoError(t, err)
}
