package controller

import (
	"encoding/json"
	appearance "github.com/nezhahq/nezha/resource/appearance"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestGreetingClockCompatibleDefaults(t *testing.T) {
	for _, raw := range []string{
		`{"version":1,"enabled":true,"features":{"greeting":{"enabled":true},"clock":{"enabled":false}}}`,
		`{"version":1,"enabled":true,"features":{"greeting":{"enabled":true,"rules":[]}}}`,
		`{"version":1,"enabled":true,"features":{"greeting":{"enabled":true,"rules":[{"name":"夜间","start":"22:30","end":"06:15","messages":["晚安"]}]},"clock":{"enabled":true,"hourEndColor":"#abcdef"}}}`,
	} {
		_, err := validateAppearance([]byte(raw))
		require.NoError(t, err)
	}
	var definitions []appearanceDefinition
	require.NoError(t, json.Unmarshal(appearance.Manifest, &definitions))
	features := map[string]map[string]any{}
	for _, d := range definitions {
		features[d.Key] = d.Defaults
	}
	raw, err := json.Marshal(appearanceDocument{Version: 1, Enabled: true, Features: features})
	require.NoError(t, err)
	normalized, err := validateAppearance(raw)
	require.NoError(t, err)
	require.Less(t, len(normalized), 128<<10)
	var result appearanceDocument
	require.NoError(t, json.Unmarshal([]byte(normalized), &result))
	require.Equal(t, features["greeting"], result.Features["greeting"])
	require.Equal(t, features["clock"], result.Features["clock"])
}
func TestGreetingClockRejectsInvalidFields(t *testing.T) {
	for _, feature := range []string{
		`"clock":{"enabled":true,"hourEndColor":"red"}`,
		`"clock":{"enabled":true,"secondStartColor":"#ffffff;background:red"}`,
		`"clock":{"enabled":true,"minuteEndColor":42}`,
		`"greeting":{"enabled":true,"rules":[{"name":"x","start":"24:00","end":"00:00","messages":[]}]}`,
		`"greeting":{"enabled":true,"rules":[{"name":"x","start":"09:00","end":"09:60","messages":[]}]}`,
		`"greeting":{"enabled":true,"rules":[{"name":"x","start":"09:00","end":"10:00","messages":[1]}]}`,
		`"greeting":{"enabled":true,"rules":[{"name":"x","start":"09:00","end":"10:00"}]}`,
	} {
		_, err := validateAppearance([]byte(`{"version":1,"enabled":true,"features":{` + feature + `}}`))
		require.Error(t, err, feature)
	}
	rules := make([]any, 33)
	for i := range rules {
		rules[i] = map[string]any{"name": "x", "start": "00:00", "end": "00:00", "messages": []any{}}
	}
	require.Error(t, validateGreetingClockFields("greeting", map[string]any{"rules": rules}))
}
