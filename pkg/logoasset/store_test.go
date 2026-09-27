package logoasset

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const pngFixture = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII="

func TestStoreAndDeduplicate(t *testing.T) {
	dir := t.TempDir()
	a, e := Put(dir, pngFixture)
	if e != nil {
		t.Fatal(e)
	}
	b, e := Put(dir, pngFixture)
	if e != nil || a != b {
		t.Fatal(b, e)
	}
	files, _ := os.ReadDir(dir)
	if len(files) != 1 {
		t.Fatal(files)
	}
	r, e := os.ReadFile(filepath.Join(dir, Name(a)))
	if e != nil {
		t.Fatal(e)
	}
	if base64.StdEncoding.EncodeToString(r) != strings.Split(pngFixture, ",")[1] {
		t.Fatal("image bytes changed")
	}
	if _, e := Put(dir, a); e != nil {
		t.Fatal(e)
	}
}
func TestInvalidSources(t *testing.T) {
	for _, v := range []string{"data:image/svg+xml;base64,PHN2Zy8+", "data:image/png;base64,bm90IGFuIGltYWdl", "data:image/png;base64,!!!", "https://example.com/a.png", Prefix + "../../config.yaml"} {
		if _, e := Put(t.TempDir(), v); e == nil {
			t.Fatal(v)
		}
	}
	for _, v := range []string{Prefix + "../x.png", Prefix + strings.Repeat("a", 64) + ".html", Prefix + strings.Repeat("a", 64) + ".png?x=1"} {
		if Name(v) != "" {
			t.Fatal(v)
		}
	}
}
func TestNoteRoundTrip(t *testing.T) {
	raw := `{"planDataMod":{"providerLogo":{"logo":"` + pngFixture + `"},"networkRouteEntries":[{"carrier":"custom","text":"X","logo":"` + pngFixture + `"}],"trafficVol":"500G/月"},"keep":9007199254740993}`
	out, n, e := ImportNote(context.Background(), t.TempDir(), raw)
	if e != nil || n != 2 {
		t.Fatal(n, e)
	}
	if !strings.Contains(out, "9007199254740993") || !strings.Contains(out, "500G/月") || strings.Contains(out, "data:image") {
		t.Fatal("unrelated fields lost")
	}
	var v map[string]any
	if json.Unmarshal([]byte(out), &v) != nil {
		t.Fatal("invalid JSON")
	}
	if n, e := Name(Prefix+strings.Repeat("b", 64)+".png"), false; n == "" || e {
		t.Fatal("valid name rejected")
	}
}
func TestNoLogoNoteUnchanged(t *testing.T) {
	raw := `{ "planDataMod": {"trafficVol":"5T/月"}, "custom": [1,2] }`
	got, n, e := ImportNote(context.Background(), t.TempDir(), raw)
	if e != nil || n != 0 || got != raw {
		t.Fatal(n, e)
	}
}
