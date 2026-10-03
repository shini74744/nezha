package controller

import "testing"

func TestAppearanceCardThemeSettings(t *testing.T) {
	for _, raw := range []string{
		`{"version":1,"enabled":true,"features":{"background":{"enabled":true,"blur":0,"opacity":0}}}`,
		`{"version":1,"enabled":true,"features":{"background":{"enabled":true,"lightOpacity":0,"darkOpacity":1,"lightBlur":0,"darkBlur":30}}}`,
	} {
		if _, err := validateAppearance([]byte(raw)); err != nil {
			t.Fatal(err)
		}
	}
	for _, field := range []string{`"lightOpacity":1.1`, `"darkOpacity":-0.1`, `"lightBlur":31`, `"darkBlur":-1`, `"darkOpacity":"0.4"`, `"lightBlur":null`} {
		raw := `{"version":1,"enabled":true,"features":{"background":{"enabled":true,` + field + `}}}`
		if _, err := validateAppearance([]byte(raw)); err == nil {
			t.Fatalf("accepted invalid field %s", field)
		}
	}
}
