package logofetch

import (
	"bytes"
	"context"
	"encoding/binary"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/url"
	"testing"
)

func testPNG(w, h int) []byte {
	var b bytes.Buffer
	png.Encode(&b, image.NewNRGBA(image.Rect(0, 0, w, h)))
	return b.Bytes()
}
func TestPrefersDeclaredLargeIcon(t *testing.T) {
	u, _ := url.Parse("https://example.com/")
	list := candidates([]byte("<link rel=icon sizes=16x16 href='/small.png'><link rel=icon sizes=192x192 href='/large.png'>"), u)
	if list[0].Path != "/large.png" {
		t.Fatal(list)
	}
}
func TestKeepsSearchingAfterSmallImage(t *testing.T) {
	c := &http.Client{Transport: roundTrip(func(r *http.Request) (*http.Response, error) {
		b := []byte("<link rel=icon href='/small.png'><link rel=icon href='/large.png'>")
		if r.URL.Path == "/small.png" {
			b = testPNG(16, 16)
		}
		if r.URL.Path == "/large.png" {
			b = testPNG(128, 128)
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(b)), Request: r, Header: make(http.Header)}, nil
	})}
	u, _ := url.Parse("https://example.com")
	r, e := fetch(context.Background(), c, u, false)
	if e != nil || r.Width != 128 {
		t.Fatal(r.Width, e)
	}
}
func TestLargestICOFrame(t *testing.T) {
	small, big := testPNG(16, 16), testPNG(128, 128)
	b := make([]byte, 38+len(small)+len(big))
	copy(b, []byte{0, 0, 1, 0, 2, 0})
	for i, part := range [][]byte{small, big} {
		p := 6 + i*16
		side := 16
		if i == 1 {
			side = 128
		}
		b[p] = byte(side)
		b[p+1] = byte(side)
		binary.LittleEndian.PutUint32(b[p+8:p+12], uint32(len(part)))
		off := 38
		if i == 1 {
			off += len(small)
		}
		binary.LittleEndian.PutUint32(b[p+12:p+16], uint32(off))
		copy(b[off:], part)
	}
	r := InspectImage(b, "fixture")
	if r.Width != 128 || r.Height != 128 {
		t.Fatal(r.Width, r.Height)
	}
	if InspectImage(b[:30], "").Image != "" {
		t.Fatal("truncated icon accepted")
	}
}
