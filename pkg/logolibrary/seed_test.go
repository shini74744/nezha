package logolibrary

import (
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/logoasset"
	"testing"
)

func TestAllSeedLogosValid(t *testing.T) {
	entries, e := SeedEntries()
	if e != nil {
		t.Fatal(e)
	}
	if len(entries) < 2000 {
		t.Fatal(len(entries))
	}
	dir := t.TempDir()
	for _, v := range entries {
		if v.Logo != "" {
			if _, e := logoasset.Put(dir, v.Logo); e != nil {
				t.Errorf("%s: %v", v.ID, e)
			}
		}
	}
}
func TestRewriteReference(t *testing.T) {
	raw := `{"unknown":9007199254740993,"planDataMod":{"trafficVol":"500G/月","providerLogo":{"logoLibraryId":"one","logo":"old","custom":true}}}`
	entries := map[string]model.LogoLibraryEntry{"one": {ID: "one", Logo: "new", Name: "厂商"}}
	n, e := RewriteNote(raw, entries, "one", false)
	if e != nil || n == raw {
		t.Fatal(n, e)
	}
	n, e = RewriteNote(n, entries, "one", true)
	if e != nil {
		t.Fatal(e)
	}
	want := `{"planDataMod":{"providerLogo":{"custom":true,"logo":"new","logoBackground":"","logoLibraryName":"厂商","logoOriginal":"","logoWebsite":""},"trafficVol":"500G/月"},"unknown":9007199254740993}`
	if n != want {
		t.Fatal(n)
	}
}
