package controller

import (
	"encoding/json"
	"errors"

	"github.com/nezhahq/nezha/model"
)

// Preserve the previously always-on Doraemon traffic display for existing installs.
// Its defaults and saved settings are independent of the default theme.
const defaultDoraemonAppearance = `{"version":1,"enabled":true,"features":{"traffic":{"enabled":true,"toggleInterval":5000}}}`

func appearanceTheme(theme string) (string, error) {
	switch theme {
	case "", "user-dist":
		return "user-dist", nil
	case "doraemon-dist":
		return theme, nil
	default:
		return "", errors.New("unsupported appearance theme")
	}
}

func validateThemeAppearance(theme string, raw []byte) (string, error) {
	if _, err := appearanceTheme(theme); err != nil {
		return "", err
	}
	if theme != "doraemon-dist" {
		return validateAppearance(raw)
	}
	if len(raw) == 0 || len(raw) > 128<<10 {
		return "", errors.New("appearance config must be 1-131072 bytes")
	}
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return "", err
	}
	var features map[string]map[string]any
	if err := json.Unmarshal(envelope["features"], &features); err != nil {
		return "", err
	}
	if features["traffic"] == nil {
		return "", errors.New("traffic feature is required")
	}
	if _, ok := features["traffic"]["toggleInterval"].(float64); !ok {
		return "", errors.New("traffic toggleInterval is required")
	}
	// Keep Doraemon-only flags out of the default theme's validator.
	visuals := map[string]map[string]any{}
	for key, feature := range features {
		if key == "traffic" {
			continue
		}
		switch key {
		case "friendsBanner", "friendsInteraction", "gadgetDecorations", "backToTop", "speedColor", "speedAnimation", "cardGadgets":
			if len(feature) != 1 {
				return "", errors.New("invalid Doraemon feature: " + key)
			}
			if _, ok := feature["enabled"].(bool); !ok {
				return "", errors.New("feature enabled must be boolean: " + key)
			}
			visuals[key] = feature
		default:
			return "", errors.New("unknown Doraemon feature: " + key)
		}
	}
	envelope["features"], _ = json.Marshal(map[string]any{"traffic": features["traffic"]})
	filtered, _ := json.Marshal(envelope)
	// This also checks version, the required master boolean, unknown envelope fields,
	// traffic fields and the interval range without weakening the default schema.
	next, err := validateAppearance(filtered)
	if err != nil {
		return "", err
	}
	var doc appearanceDocument
	if err := json.Unmarshal([]byte(next), &doc); err != nil {
		return "", err
	}
	for key, feature := range visuals {
		doc.Features[key] = feature
	}
	normalized, err := json.Marshal(doc)
	return string(normalized), err
}

func saveThemeAppearance(conf *model.Config, theme string, form appearanceForm, next string, save func() error) error {
	if _, err := appearanceTheme(theme); err != nil {
		return err
	}
	if theme != "doraemon-dist" {
		return saveNativeAppearance(&conf.AppearanceConfig, &conf.CustomCode, &conf.AppearanceLegacyCode, form, next, save)
	}
	if form.ExpectedCustomCode != nil || form.RemainingCustomCode != nil {
		return errors.New("Doraemon does not support custom code migration")
	}
	// Never point these at the default theme's code or archive.
	code, archive := "", ""
	return saveNativeAppearance(&conf.DoraemonAppearanceConfig, &code, &archive, form, next, save)
}
