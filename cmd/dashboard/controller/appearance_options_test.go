package controller

import (
	"encoding/json"
	"errors"
	"github.com/nezhahq/nezha/model"
	appearance "github.com/nezhahq/nezha/appearance/defaults"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestAppearanceOptionsCompatibilityAndValidation(t *testing.T) {
	_, err := validateAppearance([]byte(`{"version":1,"enabled":true,"features":{"font":{"enabled":true,"selection":3},"heart":{"enabled":true},"sakura":{"enabled":false},"links":{"enabled":true}}}`))
	require.NoError(t, err)
	for _, name := range []string{"duplicate-font", "missing-font", "font-url", "font-format", "font-control", "empty-palette", "invalid-color", "too-many-petals", "duration", "fractional-size"} {
		t.Run(name, func(t *testing.T) {
			var doc appearanceDocument
			require.NoError(t, json.Unmarshal(appearance.PaperDefaults, &doc))
			f := doc.Features
			switch name {
			case "duplicate-font":
				f["font"]["items"] = []any{f["font"]["items"].([]any)[0], f["font"]["items"].([]any)[0]}
			case "missing-font":
				f["font"]["activeId"] = "missing"
			case "font-url":
				f["font"]["items"].([]any)[0].(map[string]any)["url"] = "javascript:alert(1)"
			case "font-format":
				f["font"]["items"].([]any)[0].(map[string]any)["format"] = "bad"
			case "font-control":
				f["font"]["items"].([]any)[0].(map[string]any)["family"] = "foo" + string(rune(10)) + "bar"
			case "empty-palette":
				f["stars"]["palette"] = []any{}
			case "invalid-color":
				f["links"]["hoverColor"] = "red"
			case "too-many-petals":
				f["sakura"]["count"] = float64(151)
			case "duration":
				f["heart"]["duration"] = float64(0)
			case "fractional-size":
				f["stars"]["size"] = 25.5
			}
			raw, err := json.Marshal(doc)
			require.NoError(t, err)
			_, err = validateAppearance(raw)
			require.Error(t, err)
		})
	}
}
func TestPaperAppearanceIsolationAndRollback(t *testing.T) {
	raw, err := validateThemeAppearance("paper-dist", appearance.PaperDefaults)
	require.NoError(t, err)
	conf := &model.Config{}
	conf.AppearanceConfig = "default"
	conf.DoraemonAppearanceConfig = "dora"
	conf.CustomCode = "existing"
	form := appearanceForm{Revision: appearanceRevision("", "")}
	require.NoError(t, saveThemeAppearance(conf, "paper-dist", form, raw, func() error { return nil }))
	require.Equal(t, raw, conf.PaperAppearanceConfig)
	require.Equal(t, "default", conf.AppearanceConfig)
	require.Equal(t, "dora", conf.DoraemonAppearanceConfig)
	require.Equal(t, "existing", conf.CustomCode)
	require.Error(t, saveThemeAppearance(conf, "paper-dist", form, raw, func() error { return nil }))
	form.Revision = appearanceRevision(raw, "")
	require.Error(t, saveThemeAppearance(conf, "paper-dist", form, "changed", func() error { return errors.New("disk full") }))
	require.Equal(t, raw, conf.PaperAppearanceConfig)
	code := ""
	form.ExpectedCustomCode = &code
	form.RemainingCustomCode = &code
	require.Error(t, saveThemeAppearance(conf, "paper-dist", form, raw, func() error { return nil }))
}
