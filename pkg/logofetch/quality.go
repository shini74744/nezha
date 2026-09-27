package logofetch

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	_ "golang.org/x/image/webp"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"net/http"
)

// Browsers may choose a 16px ICO frame even when a larger one is embedded.
// Repack the largest valid frame (or extract its PNG) before browser decoding.
func iconFrame(b []byte) ([]byte, int, int) {
	if len(b) < 6 || !bytes.Equal(b[:4], []byte{0, 0, 1, 0}) {
		return b, 0, 0
	}
	n := int(binary.LittleEndian.Uint16(b[4:6]))
	if n < 1 || n > 256 || len(b) < 6+n*16 {
		return nil, 0, 0
	}
	best, w, h := -1, 0, 0
	for i := 0; i < n; i++ {
		p := 6 + i*16
		x, y := int(b[p]), int(b[p+1])
		if x == 0 {
			x = 256
		}
		if y == 0 {
			y = 256
		}
		size, off := uint64(binary.LittleEndian.Uint32(b[p+8:p+12])), uint64(binary.LittleEndian.Uint32(b[p+12:p+16]))
		if size == 0 || off < uint64(6+n*16) || off+size > uint64(len(b)) {
			continue
		}
		if x*y > w*h {
			best = p
			w = x
			h = y
		}
	}
	if best < 0 {
		return nil, 0, 0
	}
	size, off := int(binary.LittleEndian.Uint32(b[best+8:best+12])), int(binary.LittleEndian.Uint32(b[best+12:best+16]))
	payload := b[off : off+size]
	if bytes.HasPrefix(payload, []byte{137, 80, 78, 71, 13, 10, 26, 10}) {
		return payload, w, h
	}
	out := make([]byte, 22+size)
	copy(out, b[:6])
	binary.LittleEndian.PutUint16(out[4:6], 1)
	copy(out[6:22], b[best:best+16])
	binary.LittleEndian.PutUint32(out[18:22], 22)
	copy(out[22:], payload)
	return out, w, h
}
func InspectImage(b []byte, source string) Result {
	b, w, h := iconFrame(b)
	if len(b) == 0 {
		return Result{}
	}
	mime := http.DetectContentType(b)
	if sw, sh, e := SVGSize(b); e == nil {
		return Result{Image: "data:image/svg+xml;base64," + base64.StdEncoding.EncodeToString(b), Source: source, Width: sw, Height: sh}
	}
	switch mime {
	case "image/png", "image/jpeg", "image/gif", "image/webp":
		cfg, _, e := image.DecodeConfig(bytes.NewReader(b))
		if e != nil {
			return Result{}
		}
		w, h = cfg.Width, cfg.Height
	case "image/x-icon":
		if w == 0 || h == 0 {
			return Result{}
		}
	default:
		return Result{}
	}
	if w < 1 || h < 1 || w > 32768 || h > 32768 {
		return Result{}
	}
	return Result{Image: "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(b), Source: source, Width: w, Height: h}
}
func score(r Result) int { return min(r.Width, r.Height) }
func better(a, b Result) Result {
	if a.Image == "" || score(b) > score(a) {
		return b
	}
	return a
}
