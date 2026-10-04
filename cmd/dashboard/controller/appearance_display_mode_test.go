package controller

import (
	"encoding/json"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestAppearanceDisplayModes(t *testing.T) {
	for _, mode := range []string{"system", "light", "dark"} {
		t.Run(mode, func(t *testing.T) {
			raw := []byte(`{"version":1,"enabled":true,"features":{"dark":{"enabled":true,"mode":"` + mode + `"}}}`)
			normalized, err := validateAppearance(raw)
			require.NoError(t, err)
			var doc appearanceDocument
			require.NoError(t, json.Unmarshal([]byte(normalized), &doc))
			require.Equal(t, mode, doc.Features["dark"]["mode"])
		})
	}
}
func TestAppearanceDisplayModeLegacy(t *testing.T) {
	for _, enabled := range []string{"true", "false"} {
		_, err := validateAppearance([]byte(`{"version":1,"enabled":true,"features":{"dark":{"enabled":` + enabled + `}}}`))
		require.NoError(t, err)
	}
}
func TestAppearanceDisplayModeInvalid(t *testing.T) {
	for _, mode := range []string{`"auto"`, `""`, `"invalid"`, `null`, `3`, `{}`, `[]`} {
		_, err := validateAppearance([]byte(`{"version":1,"enabled":true,"features":{"dark":{"enabled":true,"mode":` + mode + `}}}`))
		require.Error(t, err)
	}
}
