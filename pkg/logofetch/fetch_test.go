package logofetch

import (
	"bytes"
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"testing"
)

type fakeResolver []netip.Addr

func (r fakeResolver) LookupNetIP(context.Context, string, string) ([]netip.Addr, error) {
	return r, nil
}

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestPublicIP(t *testing.T) {
	for _, s := range []string{"127.0.0.1", "10.2.3.4", "172.16.2.3", "192.168.1.1", "169.254.169.254", "100.64.0.1", "198.18.0.1", "192.0.2.2", "224.0.0.1", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "64:ff9b::a00:1", "2002:7f00:1::", "2001:db8::1"} {
		if PublicIP(netip.MustParseAddr(s)) {
			t.Error(s)
		}
	}
	for _, s := range []string{"8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"} {
		if !PublicIP(netip.MustParseAddr(s)) {
			t.Error(s)
		}
	}
}
func TestURL(t *testing.T) {
	for _, s := range []string{"file:///etc/passwd", "javascript:alert(1)", "https://user:pass@example.com", "http://localhost:7007", "https://127.0.0.1", "https://[::1]", "https://example.com:8080"} {
		if _, e := Normalize(s); e == nil {
			t.Error(s)
		}
	}
	u, e := Normalize(" www.starhub.com ")
	if e != nil || u.String() != "https://www.starhub.com" {
		t.Fatal(u, e)
	}
}
func TestRejectMixedDNS(t *testing.T) {
	_, e := resolve(context.Background(), fakeResolver{netip.MustParseAddr("1.1.1.1"), netip.MustParseAddr("127.0.0.1")}, "test")
	if e == nil {
		t.Fatal("mixed DNS accepted")
	}
}
func TestIconCandidates(t *testing.T) {
	u, _ := url.Parse("https://example.com/sub/page")
	got := candidates([]byte("<link rel='shortcut ICON' href='../brand.png'><link rel=icon href='http://127.0.0.1/a'><link rel=icon href='//cdn.example.org/i.png'>"), u)
	if len(got) != 4 || got[0].String() != "https://example.com/brand.png" || got[1].Host != "cdn.example.org" {
		t.Fatal(got)
	}
}

const pngFixture = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII="

func TestFetchPageAndImage(t *testing.T) {
	png, _ := base64.StdEncoding.DecodeString(pngFixture)
	calls := 0
	c := &http.Client{Transport: roundTrip(func(r *http.Request) (*http.Response, error) {
		calls++
		b := []byte("<link rel=icon href='/brand.png'>")
		if r.URL.Path == "/brand.png" {
			b = png
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(b)), Request: r, Header: make(http.Header)}, nil
	})}
	u, _ := Normalize("example.com")
	result, e := fetch(context.Background(), c, u, false)
	if e != nil || !strings.HasPrefix(result.Image, "data:image/png;base64,") || calls != 2 {
		t.Fatal(result.Source, e, calls)
	}
}
func TestNoSVGAndOversizedResponse(t *testing.T) {
	if imageData([]byte("<svg onload='alert(1)'></svg>")) != "" {
		t.Fatal("SVG accepted")
	}
	c := &http.Client{Transport: roundTrip(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(strings.Repeat("x", MaxBody+1))), Request: r, Header: make(http.Header)}, nil
	})}
	u, _ := Normalize("example.com")
	if _, _, e := read(context.Background(), c, u); e == nil {
		t.Fatal("oversize accepted")
	}
}
func TestRedirectGuard(t *testing.T) {
	c, tr := client()
	defer tr.CloseIdleConnections()
	u, _ := url.Parse("http://169.254.169.254")
	if c.CheckRedirect(&http.Request{URL: u}, nil) == nil {
		t.Fatal("private redirect accepted")
	}
	u, _ = url.Parse("https://example.com")
	if c.CheckRedirect(&http.Request{URL: u}, make([]*http.Request, 4)) == nil {
		t.Fatal("redirect loop accepted")
	}
	if tr.Proxy != nil {
		t.Fatal("proxy bypasses DNS pin")
	}
}
func TestCacheDomainOnly(t *testing.T) {
	u, _ := Normalize("https://example.com/private?secret=test")
	for _, v := range cacheURLs(u) {
		if strings.Contains(v.String(), "secret") || strings.Contains(v.String(), "private") {
			t.Fatal(v)
		}
	}
}
