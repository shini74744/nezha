package logofetch

import (
	"strings"
	"testing"
)

func TestStaticSVG(t *testing.T) {
	good := `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 130.9 176.53"><defs><style>.cls-1{fill:#1ed760;}</style></defs><g><path class="cls-1" d="M1 1L9 9"/></g></svg>`
	w, h, e := SVGSize([]byte(good))
	if e != nil || w != 131 || h != 177 {
		t.Fatal(w, h, e)
	}
	if InspectImage([]byte(good), "").Image == "" {
		t.Fatal("valid SVG was rejected")
	}
	for _, body := range []string{`<script>alert(1)</script>`, `<foreignObject/>`, `<use href="https://example.com/x"/>`, `<g onload="x"/>`, `<g xml:base="https://example.com"/>`, `<style>@import "x";</style>`, `<style>.a{fill:url(https://example.com/a)}</style>`, `<style>.a{fill:u<!-- -->rl(https://example.com/a)}</style>`, `<style>.a{fill:u\72l(https://example.com)}</style>`, `<style>.a{fill:image-set("x.png")}</style>`, `<g style="fill:u/**/rl(x)"/>`} {
		if _, _, e := SVGSize([]byte(`<svg viewBox="0 0 10 10">` + body + `</svg>`)); e == nil {
			t.Fatal("unsafe", body)
		}
	}
	for _, body := range []string{`<!DOCTYPE svg><svg viewBox="0 0 1 1"/>`, `<svg viewBox="0 0 NaN 1"/>`, `<svg viewBox="0 0 1 1"/><svg/>`, strings.Repeat(" ", MaxBody+1)} {
		if _, _, e := SVGSize([]byte(body)); e == nil {
			t.Fatal("invalid SVG accepted")
		}
	}
}
