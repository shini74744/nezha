package controller

import (
	"encoding/json"
	"errors"
	"github.com/nezhahq/nezha/model"
	appearance "github.com/nezhahq/nezha/resource/appearance"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestDashboardAppearanceValidation(t *testing.T) {
	var defs []appearanceDefinition
	require.NoError(t, json.Unmarshal(appearance.DashboardManifest, &defs))
	features := map[string]any{}
	for _, d := range defs {
		features[d.Key] = d.Defaults
	}
	raw, err := json.Marshal(map[string]any{"version": 1, "enabled": true, "features": features})
	require.NoError(t, err)
	_, err = validateDashboardAppearance(raw)
	require.NoError(t, err)
	for _, f := range []string{
		`"font":{"enabled":true,"cssUrl":"javascript:alert(1)"}`,
		`"font":{"enabled":true,"size":"16px;display:none"}`,
		`"appearance":{"enabled":true,"lightCardOpacity":2}`,
		`"effects":{"enabled":true,"shatterCount":2.5}`,
		`"brand":{"enabled":true,"avatar":"https://user:pass@example.com"}`,
		`"utilities":{"enabled":true,"timezone":"Invalid/Zone"}`,
		`"background":{"enabled":true,"attachment":"oops"}`,
		`"unknown":{"enabled":true}`,
	} {
		_, err = validateDashboardAppearance([]byte(`{"version":1,"enabled":true,"features":{` + f + `}}`))
		require.Error(t, err, f)
	}
}
func TestDashboardAppearanceArchiveAndRollback(t *testing.T) {
	config, code, archive := "old", "legacy", ""
	source, empty := code, ""
	form := dashboardAppearanceForm{appearanceForm: appearanceForm{Revision: appearanceRevision(config, code+"\x00"+archive), ExpectedCustomCode: &source, RemainingCustomCode: &empty}, SourceCode: &source}
	require.Error(t, saveDashboardAppearance(&config, &code, &archive, form, "next", func() error { return errors.New("disk failure") }))
	require.Equal(t, "old", config)
	require.Equal(t, "legacy", code)
	require.Empty(t, archive)
	saves := 0
	save := func() error { saves++; return nil }
	require.NoError(t, saveDashboardAppearance(&config, &code, &archive, form, "next", save))
	require.Equal(t, "next", config)
	require.Empty(t, code)
	require.Equal(t, "legacy", archive)
	require.Equal(t, 1, saves)
	require.Error(t, saveDashboardAppearance(&config, &code, &archive, form, "bad", save))
	require.Equal(t, 1, saves)
	form = dashboardAppearanceForm{appearanceForm: appearanceForm{Revision: appearanceRevision(config, code+"\x00"+archive)}}
	require.NoError(t, saveDashboardAppearance(&config, &code, &archive, form, "next", save))
	require.Equal(t, 1, saves)
	other := "other source"
	form.SourceCode = &other
	require.Error(t, saveDashboardAppearance(&config, &code, &archive, form, "bad", save))
	require.Equal(t, "legacy", archive)
	raw, err := json.Marshal(model.ConfigDashboard{DashboardAppearanceLegacyCode: "private-dashboard-backup"})
	require.NoError(t, err)
	require.NotContains(t, string(raw), "private-dashboard-backup")
}
func TestDashboardAppearancePastedSource(t *testing.T) {
	config, code, archive := "", "", ""
	source := "pasted source"
	form := dashboardAppearanceForm{appearanceForm: appearanceForm{Revision: appearanceRevision(config, code+"\x00"+archive)}, SourceCode: &source}
	require.NoError(t, saveDashboardAppearance(&config, &code, &archive, form, "next", func() error { return nil }))
	require.Equal(t, source, archive)
	require.Empty(t, code)
}
