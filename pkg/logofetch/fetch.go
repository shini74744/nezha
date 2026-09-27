// Package logofetch retrieves public website icons without exposing an open proxy.
package logofetch

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"golang.org/x/net/html"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"sort"
	"strings"
	"time"
)

const MaxBody = 2 << 20

var ErrFetch = errors.New("无法获取可用图标，请检查网址，或手动上传 PNG/JPEG/WebP/GIF 图片")

type Result struct {
	Image  string `json:"image"`
	Source string `json:"source"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

var blocked = []string{"0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4", "2001::/23", "2001:db8::/32", "2002::/16", "3fff::/20"}

func PublicIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsValid() || !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	if ip.Is6() && !netip.MustParsePrefix("2000::/3").Contains(ip) {
		return false
	}
	for _, s := range blocked {
		if netip.MustParsePrefix(s).Contains(ip) {
			return false
		}
	}
	return true
}
func Normalize(raw string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	u, e := url.Parse(raw)
	if e != nil || len(raw) > 2048 || u.Hostname() == "" || u.User != nil || (u.Scheme != "https" && u.Scheme != "http") || (u.Port() != "" && u.Port() != "443" && u.Port() != "80") {
		return nil, ErrFetch
	}
	if ip, e := netip.ParseAddr(u.Hostname()); e == nil && !PublicIP(ip) {
		return nil, ErrFetch
	}
	u.Fragment = ""
	return u, nil
}

type resolver interface {
	LookupNetIP(context.Context, string, string) ([]netip.Addr, error)
}

func resolve(ctx context.Context, r resolver, host string) ([]netip.Addr, error) {
	ips, e := r.LookupNetIP(ctx, "ip", host)
	if e != nil || len(ips) == 0 {
		return nil, ErrFetch
	}
	for _, ip := range ips {
		if !PublicIP(ip) {
			return nil, ErrFetch
		}
	}
	return ips, nil
}
func client() (*http.Client, *http.Transport) {
	tr := &http.Transport{Proxy: nil, DisableKeepAlives: true, ResponseHeaderTimeout: 5 * time.Second, TLSHandshakeTimeout: 5 * time.Second, MaxResponseHeaderBytes: 32 << 10}
	tr.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, e := net.SplitHostPort(address)
		if e != nil {
			return nil, e
		}
		ips, e := resolve(ctx, net.DefaultResolver, host)
		if e != nil {
			return nil, e
		}
		var last error
		for _, ip := range ips {
			c, e := (&net.Dialer{Timeout: 4 * time.Second}).DialContext(ctx, "tcp", net.JoinHostPort(ip.String(), port))
			if e == nil {
				return c, nil
			}
			last = e
		}
		return nil, last
	}
	return &http.Client{Transport: tr, Timeout: 7 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 4 {
			return ErrFetch
		}
		_, e := Normalize(req.URL.String())
		return e
	}}, tr
}
func read(ctx context.Context, c *http.Client, u *url.URL) ([]byte, *url.URL, error) {
	req, e := http.NewRequestWithContext(ctx, "GET", u.String(), nil)
	if e != nil {
		return nil, nil, e
	}
	req.Header.Set("User-Agent", "Nezha-Logo/1.0")
	req.Header.Set("Accept", "text/html,image/png,image/jpeg,image/webp,image/gif,image/x-icon;q=0.9,*/*;q=0.1")
	resp, e := c.Do(req)
	if e != nil {
		return nil, nil, ErrFetch
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, nil, ErrFetch
	}
	b, e := io.ReadAll(io.LimitReader(resp.Body, MaxBody+1))
	if e != nil || len(b) > MaxBody {
		return nil, nil, ErrFetch
	}
	return b, resp.Request.URL, nil
}
func imageData(b []byte) string { return InspectImage(b, "").Image }
func candidates(b []byte, base *url.URL) []*url.URL {
	type candidate struct {
		u    *url.URL
		size int
	}
	var list []candidate
	seen := map[string]bool{}
	add := func(href string, size int) {
		u, e := url.Parse(strings.TrimSpace(href))
		if e != nil || href == "" {
			return
		}
		u = base.ResolveReference(u)
		u, e = Normalize(u.String())
		if e == nil && !seen[u.String()] && len(list) < 20 {
			seen[u.String()] = true
			list = append(list, candidate{u, size})
		}
	}
	z := html.NewTokenizer(bytes.NewReader(b))
	for {
		tt := z.Next()
		if tt == html.ErrorToken {
			break
		}
		if tt != html.StartTagToken && tt != html.SelfClosingTagToken {
			continue
		}
		t := z.Token()
		if t.Data != "link" {
			continue
		}
		rel, href, sizes := "", "", ""
		for _, a := range t.Attr {
			switch a.Key {
			case "rel":
				rel = strings.ToLower(a.Val)
			case "href":
				href = a.Val
			case "sizes":
				sizes = a.Val
			}
		}
		size := 0
		for _, s := range strings.Fields(sizes) {
			var w, h int
			if _, e := fmt.Sscanf(s, "%dx%d", &w, &h); e == nil {
				size = max(size, min(w, h))
			}
		}
		for _, r := range strings.Fields(rel) {
			if r == "icon" || r == "apple-touch-icon" || r == "apple-touch-icon-precomposed" {
				if size == 0 && r != "icon" {
					size = 180
				}
				add(href, size)
				break
			}
		}
	}
	sort.SliceStable(list, func(i, j int) bool { return list[i].size > list[j].size })
	if len(list) > 8 {
		list = list[:8]
	}
	add("/apple-touch-icon.png", 0)
	add("/favicon.ico", 0)
	out := make([]*url.URL, 0, len(list))
	for _, c := range list {
		out = append(out, c.u)
	}
	return out
}
func fetch(ctx context.Context, c *http.Client, u *url.URL, direct bool) (Result, error) {
	b, final, e := read(ctx, c, u)
	best := Result{}
	if e == nil {
		best = InspectImage(b, final.String())
		if best.Image != "" {
			return best, nil
		}
	}
	if direct {
		return Result{}, ErrFetch
	}
	if final == nil {
		final = u
	}
	for _, candidate := range candidates(b, final) {
		if ctx.Err() != nil {
			break
		}
		data, source, e := read(ctx, c, candidate)
		if e != nil {
			continue
		}
		best = better(best, InspectImage(data, source.String()))
		if score(best) >= 64 {
			return best, nil
		}
	}
	if best.Image != "" {
		return best, nil
	}
	return Result{}, ErrFetch
}
func cacheURLs(u *url.URL) []*url.URL {
	host := strings.TrimSuffix(strings.ToLower(u.Hostname()), ".")
	google, _ := url.Parse("https://www.google.com/s2/favicons?sz=128&domain=" + url.QueryEscape(host))
	ddg, _ := url.Parse("https://icons.duckduckgo.com/ip3/" + url.PathEscape(host) + ".ico")
	return []*url.URL{google, ddg}
}
func Fetch(ctx context.Context, raw string, direct bool) (Result, error) {
	u, e := Normalize(raw)
	if e != nil {
		return Result{}, e
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	// Resolve before contacting a cache: private or nonexistent hosts must not be disclosed.
	dnsCtx, dnsCancel := context.WithTimeout(ctx, 4*time.Second)
	_, e = resolve(dnsCtx, net.DefaultResolver, u.Hostname())
	dnsCancel()
	if e != nil {
		return Result{}, ErrFetch
	}
	c, tr := client()
	defer tr.CloseIdleConnections()
	first, stop := context.WithTimeout(ctx, 12*time.Second)
	r, e := fetch(first, c, u, direct)
	stop()
	if e == nil && (direct || score(r) >= 64) {
		return r, nil
	}
	best := r
	if direct {
		return Result{}, ErrFetch
	}
	for _, cacheURL := range cacheURLs(u) {
		if ctx.Err() != nil {
			break
		}
		r, e = fetch(ctx, c, cacheURL, true)
		if e == nil {
			best = better(best, r)
			if score(best) >= 64 {
				return best, nil
			}
		}
	}
	if best.Image != "" {
		return best, nil
	}
	return Result{}, ErrFetch
}
