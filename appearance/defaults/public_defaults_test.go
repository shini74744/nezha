package appearance

import (
	"encoding/json"
	"net/url"
	"strings"
	"testing"
)

// Public configuration examples must work without any site's media account or credentials.
func TestPublicAppearanceExamples(t *testing.T) {
	type feature struct {
		Key      string         `json:"key"`
		Defaults map[string]any `json:"defaults"`
	}
	check := func(scope, key string, value any) {
		t.Helper()
		var walk func(string, any)
		walk = func(field string, value any) {
			switch v := value.(type) {
			case map[string]any:
				for k, child := range v {
					walk(k, child)
				}
			case []any:
				for _, child := range v {
					walk(field, child)
				}
			case string:
				if field == "measurementId" && v != "" {
					t.Errorf("%s.%s contains a default analytics identifier", scope, key)
				}
				if !strings.HasPrefix(v, "https://") && !strings.HasPrefix(v, "http://") {
					return
				}
				if field == "poweredUrl" && v == "https://github.com/shini74744/nezha" {
					return
				}
				u, err := url.Parse(v)
				if err != nil || !strings.HasSuffix(u.Hostname(), ".invalid") || u.User != nil || u.RawQuery != "" {
					t.Errorf("%s.%s.%s must use a reserved example address", scope, key, field)
				}
			}
		}
		walk(key, value)
	}
	for name, data := range map[string][]byte{"site": Manifest, "admin": DashboardManifest} {
		var defs []feature
		if err := json.Unmarshal(data, &defs); err != nil {
			t.Fatal(err)
		}
		for _, def := range defs {
			check(name, def.Key, def.Defaults)
		}
	}
	var paper struct{ Features map[string]any }
	if err := json.Unmarshal(PaperDefaults, &paper); err != nil {
		t.Fatal(err)
	}
	for key, cfg := range paper.Features {
		check("paper", key, cfg)
	}
}
