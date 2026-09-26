package controller

import (
	"encoding/json"
	"errors"
	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"strings"
	"testing"
)

func TestAppearanceValidation(t *testing.T) {
	good := `{"version":1,"enabled":true,"features":{"sponsor":{"enabled":true,"startText":"感谢"}}}`
	normalized, err := validateAppearance([]byte(good))
	require.NoError(t, err)
	require.True(t, json.Valid([]byte(normalized)))
	for _, raw := range []string{"", "null", "{}", good + "{}", `{"version":2,"features":{}}`, `{"version":1,"features":{"unknown":{"enabled":true}}}`, `{"version":1,"features":{"sponsor":{"enabled":"yes"}}}`, `{"version":1,"features":{},"agent_secret_key":"x"}`, strings.Repeat(" ", 128<<10+1)} {
		_, err = validateAppearance([]byte(raw))
		require.Error(t, err, raw[:min(len(raw), 200)])
	}
}
func TestAppearanceRevisionAndRollback(t *testing.T) {
	config, code, archive := "", "legacy-code", ""
	before := appearanceRevision(config, code)
	remaining := ""
	form := appearanceForm{Revision: before, ExpectedCustomCode: &code, RemainingCustomCode: &remaining}
	expected := code
	form.ExpectedCustomCode = &expected
	err := saveNativeAppearance(&config, &code, &archive, form, "next", func() error { return errors.New("disk failure") })
	require.Error(t, err)
	require.Equal(t, "", config)
	require.Equal(t, "legacy-code", code)
	require.Empty(t, archive)
	saves := 0
	save := func() error { saves++; return nil }
	require.NoError(t, saveNativeAppearance(&config, &code, &archive, form, "next", save))
	require.Equal(t, "next", config)
	require.Empty(t, code)
	require.Equal(t, "legacy-code", archive)
	require.Equal(t, 1, saves)
	require.Error(t, saveNativeAppearance(&config, &code, &archive, form, "overwrite", save))
	require.Equal(t, 1, saves)
	form = appearanceForm{Revision: appearanceRevision(config, code)}
	require.NoError(t, saveNativeAppearance(&config, &code, &archive, form, "next", save))
	require.Equal(t, 1, saves, "no-op should not touch disk")
}
func TestAppearanceNeverOverwritesArchive(t *testing.T) {
	config, code, archive := "before", "new custom", "original backup"
	expected, remaining := code, ""
	form := appearanceForm{Revision: appearanceRevision(config, code), ExpectedCustomCode: &expected, RemainingCustomCode: &remaining}
	require.Error(t, saveNativeAppearance(&config, &code, &archive, form, "after", func() error { t.Fatal("must not save"); return nil }))
	require.Equal(t, "before", config)
	require.Equal(t, "new custom", code)
	require.Equal(t, "original backup", archive)
}
func TestAppearanceArchiveNotExposed(t *testing.T) {
	c := model.ConfigDashboard{AppearanceLegacyCode: "private-backup"}
	raw, err := json.Marshal(c)
	require.NoError(t, err)
	require.NotContains(t, string(raw), "private-backup")
}

func TestAppearanceNestedValidation(t *testing.T) {
	for _, feature := range []string{
		"\"background\":{\"enabled\":true,\"desktopMedia\":[{\"type\":\"video\",\"src\":\"javascript:alert(1)\"}]}",
		"\"background\":{\"enabled\":true,\"desktopMedia\":[{\"type\":\"image\"}]}",
		"\"background\":{\"enabled\":true,\"nightImages\":[null]}",
		"\"snow\":{\"enabled\":true,\"count\":0}",
		"\"snow\":{\"enabled\":true,\"mobileCount\":1.5}",
		"\"branding\":{\"enabled\":true,\"links\":[{\"name\":\"x\",\"link\":\"data:text/html,a\"}]}",
		"\"live2d\":{\"enabled\":true,\"tools\":[\"invalid\"]}",
		"\"network\":{\"enabled\":true,\"color\":\"0,0,0);background:red\"}",
		"\"font\":{\"enabled\":true,\"selection\":8}",
		"\"runtime\":{\"enabled\":true,\"startDate\":\"invalid\"}",
		"\"sponsor\":{\"enabled\":true,\"fadeDuration\":-1}",
		"\"speed\":{\"enabled\":true,\"bits\":\"yes\"}",
		"\"heart\":{\"enabled\":true,\"unknown\":true}",
	} {
		_, err := validateAppearance([]byte("{\"version\":1,\"enabled\":true,\"features\":{" + feature + "}}"))
		require.Error(t, err, feature)
	}
	_, err := validateAppearance([]byte("{\"version\":1,\"enabled\":null,\"features\":{}}"))
	require.Error(t, err)
}

func TestAppearanceRemovedEffectsRejected(t *testing.T) {
	for _, feature := range []string{"wave", "meihua"} {
		_, err := validateAppearance([]byte(`{"version":1,"enabled":true,"features":{"` + feature + `":{"enabled":true}}}`))
		if err == nil {
			t.Fatalf("removed feature %s must not be accepted", feature)
		}
	}
}
