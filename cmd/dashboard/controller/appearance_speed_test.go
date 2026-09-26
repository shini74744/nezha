package controller

import (
	"encoding/json"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestAppearanceIndependentSpeed(t *testing.T) {
	for _, fields := range []string{
		`"enabled":true,"bits":false,"color":false,"animation":false`,
		`"enabled":false`,
		`"enabled":true,"bits":false,"color":false,"animation":false,"cardEnabled":false,"overviewEnabled":true,"overviewBits":true,"overviewColor":true,"overviewAnimation":true`,
	} {
		raw := `{"version":1,"enabled":true,"features":{"speed":{` + fields + `}}}`
		saved, err := validateAppearance([]byte(raw))
		require.NoError(t, err)
		var before, after any
		require.NoError(t, json.Unmarshal([]byte(raw), &before))
		require.NoError(t, json.Unmarshal([]byte(saved), &after))
		require.Equal(t, before, after, "saving must preserve independent and legacy choices")
	}
	for _, key := range []string{"cardEnabled", "overviewEnabled", "overviewBits", "overviewColor", "overviewAnimation"} {
		_, err := validateAppearance([]byte(`{"version":1,"enabled":true,"features":{"speed":{"enabled":true,"` + key + `":"yes"}}}`))
		require.Error(t, err, key)
	}
}
