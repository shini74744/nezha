package controller

import "testing"

func TestAppearanceMascotAndIndependentPeakCut(t *testing.T) {
	for _, provider := range []string{"live2d", "sakana"} {
		f := map[string]map[string]any{"live2d": {"enabled": true, "provider": provider, "character": "takina", "size": float64(200), "autoMotion": false, "controls": true}, "peakCut": {"enabled": true, "desktop": false, "mobile": true}}
		if err := validateAppearanceFields(f); err != nil {
			t.Fatal(err)
		}
	}
	for _, bad := range []map[string]any{{"provider": "invalid"}, {"character": "invalid"}, {"size": float64(119)}} {
		if err := validateAppearanceFields(map[string]map[string]any{"live2d": bad}); err == nil {
			t.Fatalf("accepted %v", bad)
		}
	}
	if err := validateAppearanceFields(map[string]map[string]any{"live2d": {"enabled": true}, "background": {"enabled": true, "peakCutDesktop": true}}); err != nil {
		t.Fatal(err)
	}
}

func TestAppearanceCustomMascot(t *testing.T) {
	row := map[string]any{"id": "custom-one", "name": "自定义", "imageUrl": "https://example.test/role.png"}
	f := map[string]any{"enabled": true, "provider": "sakana", "character": "custom-one", "customCharacters": []any{row}}
	if err := validateAppearanceFields(map[string]map[string]any{"live2d": f}); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []map[string]any{{"id": "chisato", "name": "role", "imageUrl": "https://example.test/x"}, {"id": "custom-one", "name": "", "imageUrl": "https://example.test/x"}, {"id": "custom-one", "name": "role", "imageUrl": "javascript:alert(1)"}, {"id": "custom-one", "name": "role", "imageUrl": "https://u:p@example.test/x"}} {
		f["customCharacters"] = []any{bad}
		if err := validateAppearanceFields(map[string]map[string]any{"live2d": f}); err == nil {
			t.Fatal("accepted invalid role")
		}
	}
	f["customCharacters"] = []any{row, row}
	if err := validateMascotFields(f); err == nil {
		t.Fatal("duplicate accepted")
	}
	f["customCharacters"] = []any{}
	if err := validateMascotFields(f); err == nil {
		t.Fatal("missing selected role accepted")
	}
}

func TestCustomMascotScale(t *testing.T) {
	for _, tc := range []struct {
		v     any
		valid bool
	}{{float64(25), true}, {float64(100), true}, {float64(200), true}, {float64(24), false}, {float64(201), false}, {"100", false}, {nil, false}} {
		row := map[string]any{"id": "custom-one", "name": "role", "imageUrl": "https://example.test/x", "scale": tc.v}
		err := validateAppearanceFields(map[string]map[string]any{"live2d": {"customCharacters": []any{row}}})
		if (err == nil) != tc.valid {
			t.Fatalf("scale=%v err=%v", tc.v, err)
		}
	}
}
