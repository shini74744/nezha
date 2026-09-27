package logofetch

import (
	"bytes"
	"encoding/xml"
	"errors"
	"io"
	"math"
	"regexp"
	"strconv"
	"strings"
)

var localPaint = regexp.MustCompile(`(?i)url\(\s*['"]?#[a-z_][a-z0-9_.:-]*['"]?\s*\)`)

func safeSVGValue(s string) bool {
	s = strings.ToLower(s)
	return !strings.ContainsAny(s, "\\@") && !strings.Contains(s, "/*") && !strings.Contains(s, "javascript:") && !strings.Contains(s, "image-set(") && !strings.Contains(s, "src(") && !strings.Contains(s, "expression(") && !strings.Contains(s, "-moz-binding") && !strings.Contains(localPaint.ReplaceAllString(s, ""), "url")
}
func SVGSize(b []byte) (int, int, error) {
	bad := errors.New("unsafe or unsupported SVG")
	if len(b) > MaxBody {
		return 0, 0, bad
	}
	allowed := map[string]bool{}
	for _, n := range strings.Fields("svg g path defs style rect circle ellipse line polyline polygon title desc linearGradient radialGradient stop clipPath mask pattern symbol use filter feGaussianBlur feOffset feBlend feColorMatrix feComposite feFlood feMerge feMergeNode") {
		allowed[n] = true
	}
	d := xml.NewDecoder(bytes.NewReader(b))
	depth, nodes := 0, 0
	seen, inStyle := false, false
	w, h := 0.0, 0.0
	var styleText strings.Builder
	for {
		token, e := d.Token()
		if e == io.EOF {
			break
		}
		if e != nil {
			return 0, 0, bad
		}
		switch t := token.(type) {
		case xml.Directive:
			return 0, 0, bad
		case xml.ProcInst:
			if t.Target != "xml" {
				return 0, 0, bad
			}
		case xml.StartElement:
			if inStyle || !allowed[t.Name.Local] || (t.Name.Space != "" && t.Name.Space != "http://www.w3.org/2000/svg") {
				return 0, 0, bad
			}
			if depth == 0 {
				if seen || t.Name.Local != "svg" {
					return 0, 0, bad
				}
				seen = true
			}
			depth++
			nodes++
			if nodes > 10000 {
				return 0, 0, bad
			}
			for _, a := range t.Attr {
				name := strings.ToLower(a.Name.Local)
				if strings.HasPrefix(name, "on") || name == "base" {
					return 0, 0, bad
				}
				if name == "href" && (!strings.HasPrefix(a.Value, "#") || len(a.Value) < 2) {
					return 0, 0, bad
				}
				if !safeSVGValue(a.Value) {
					return 0, 0, bad
				}
				if depth == 1 && name == "viewbox" {
					parts := strings.Fields(strings.ReplaceAll(a.Value, ",", " "))
					if len(parts) == 4 {
						w, _ = strconv.ParseFloat(parts[2], 64)
						h, _ = strconv.ParseFloat(parts[3], 64)
					}
				}
			}
			inStyle = t.Name.Local == "style"
			if inStyle {
				styleText.Reset()
			}
		case xml.EndElement:
			if t.Name.Local == "style" {
				if !safeSVGValue(styleText.String()) {
					return 0, 0, bad
				}
				inStyle = false
			}
			depth--
		case xml.CharData:
			if inStyle {
				styleText.Write(t)
			}
			if inStyle && !safeSVGValue(string(t)) {
				return 0, 0, bad
			}
			if depth == 0 && strings.TrimSpace(string(t)) != "" {
				return 0, 0, bad
			}
		}
	}
	if !seen || depth != 0 {
		return 0, 0, bad
	}
	if w <= 0 || h <= 0 || w > 32768 || h > 32768 || math.IsNaN(w) || math.IsNaN(h) {
		return 0, 0, bad
	}
	return int(math.Ceil(w)), int(math.Ceil(h)), nil
}
