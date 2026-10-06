package networkinsight

import (
	"context"
	"fmt"
	"github.com/stretchr/testify/require"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestBGPAggregation(t *testing.T) {
	routes := []Route{
		{"8.8.8.0/24", "peer1", []uint32{174, 1299, 1299, 15169}},
		{"8.8.8.0/24", "peer2", []uint32{174, 1299, 15169}},
		{"8.8.8.0/24", "peer2", []uint32{174, 1299, 15169}},
		{"8.8.8.0/24", "peer3", []uint32{3356, 15169}},
		{"8.8.8.0/24", "loop", []uint32{15169, 174, 15169}},
		{"8.8.0.0/16", "other", []uint32{3356, 15169}},
	}
	out, total := Aggregate(routes, "8.8.8.0/24")
	require.Equal(t, 3, total)
	require.Len(t, out, 2)
	require.Equal(t, 2, out[0].Count)
	require.EqualValues(t, 15169, out[0].Origin.ASN)
	require.EqualValues(t, 1299, out[0].Direct.ASN)
	require.EqualValues(t, 174, out[0].Second.ASN)
	require.Nil(t, out[1].Second)
	for _, ip := range []string{"", "invalid", "127.0.0.1", "10.0.0.1", "192.0.2.1", "100.64.0.1", "::1", "::ffff:127.0.0.1", "fe80::1", "fc00::1", "2001:db8::1"} {
		require.False(t, PublicIP(ip), ip)
	}
	require.True(t, PublicIP("8.8.8.8"))
	require.True(t, PublicIP("2606:4700:4700::1111"))
}

type rewriteTransport struct{ to *url.URL }

func (r rewriteTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	c := req.Clone(req.Context())
	c.URL.Scheme = r.to.Scheme
	c.URL.Host = r.to.Host
	return http.DefaultTransport.RoundTrip(c)
}
func TestBGPQueryFixedSourceAndPrefix(t *testing.T) {
	requests := []string{}
	var requestsMu sync.Mutex
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestsMu.Lock()
		requests = append(requests, r.URL.Query().Get("resource"))
		requestsMu.Unlock()
		if strings.Contains(r.URL.Path, "as-overview") {
			fmt.Fprint(w, "{\"status\":\"ok\",\"data\":{\"holder\":\"Google\"}}")
			return
		}
		fmt.Fprint(w, "{\"status\":\"ok\",\"data\":{\"timestamp\":\"2026-10-06T00:00:00\",\"bgp_state\":[{\"target_prefix\":\"8.8.0.0/16\",\"source_id\":\"a\",\"path\":[174,15169]},{\"target_prefix\":\"8.8.8.0/24\",\"source_id\":\"b\",\"path\":[15169]}]}}")
	}))
	defer srv.Close()
	old := ripeClient
	u, _ := url.Parse(srv.URL)
	ripeClient = &http.Client{Transport: rewriteTransport{u}}
	defer func() { ripeClient = old }()
	got := QueryBGP(context.Background(), "8.8.8.8", "IPv4")
	require.Equal(t, "ok", got.Status)
	require.Equal(t, "8.8.8.0/24", got.Prefix)
	require.Equal(t, 1, got.Total)
	require.Equal(t, "8.8.8.8", requests[0])
	before := len(requests)
	require.Equal(t, "no_public_ip", QueryBGP(context.Background(), "10.0.0.1", "IPv4").Status)
	require.Len(t, requests, before)
}
func TestMediaClassification(t *testing.T) {
	cases := []struct{ id, raw, want string }{
		{"youtube", "NZM|0|200|0||US", "unknown"},
		{"youtube", "NZM|0|200|0|premium,|US", "unlocked"},
		{"youtube", "NZM|0|200|0|premium,|", "unknown"},
		{"youtube", "NZM|0|200|0|challenge,premium,|US", "challenge"},
		{"youtube", "NZM|0|200|0|restricted,premium,|CN", "restricted"},
		{"youtube", "NZM|0|200|28|premium,|US", "timeout"},
		{"youtube", "NZM|0|000|6||", "dns_error"},
		{"youtube", "NZM|0|429|0||", "challenge"},
		{"youtube", "NZM|0|403|0||", "blocked"},
		{"youtube", "untrusted HTML or shell output", "unknown"},
		{"youtube", "NZM_UNSUPPORTED", "unsupported"},
		{"netflix", "NZM|0|200|0|title,|US\nNZM|1|200|0|title,|US\nNZM|2|200|0|restricted,|US", "unlocked"},
		{"netflix", "NZM|0|200|0|title,|US\nNZM|1|404|0||US\nNZM|2|200|0|restricted,|US", "originals"},
		{"netflix", "NZM|0|200|0||US\nNZM|1|404|0||US\nNZM|2|404|0||US", "unknown"},
		{"netflix", "NZM|0|200|0|title,|US\nNZM|1|200|0|title,|US", "unknown"},
		{"disneyplus", "NZM|0|200|0||US", "reachable"},
		{"tvb", "NZM|0|200|0|allowed,|US", "unlocked"},
		{"bbc", "NZM|0|200|0|bbc,|", "unlocked"},
	}
	for _, c := range cases {
		require.Equal(t, c.want, ClassifyMedia(c.id, "IPv4", c.raw, true).Status, c.raw)
	}
	require.Equal(t, "disabled", ClassifyMedia("youtube", "IPv4", "command disabled", false).Status)
	require.Empty(t, ClassifyMedia("youtube", "IPv4", "NZM|0|200|0|premium,|<script>", true).Region)
}
func TestMediaFixedShellExtraction(t *testing.T) {
	_, err := MediaCommand("youtube; touch /tmp/bad", "IPv4")
	require.Error(t, err)
	_, err = MediaCommand("youtube", "-o /tmp/bad")
	require.Error(t, err)
	dir := t.TempDir()
	script := "#!/bin/sh\nwhile [ $# -gt 0 ]; do\nif [ \"$1\" = '-o' ]; then shift; dest=$1; fi\nshift\ndone\nprintf '%s' \"$NZ_TEST_BODY\" > \"$dest\"\nprintf 200\n"
	require.NoError(t, os.WriteFile(filepath.Join(dir, "curl"), []byte(script), 0700))
	for _, c := range []struct{ id, body, want string }{
		{"youtube", "{\"INNERTUBE_CONTEXT_GL\":\"JP\"} YouTube Premium ad-free", "unlocked"},
		{"youtube", "<title>Just a moment</title>{\"countryCode\":\"US\"} ad-free", "challenge"},
		{"youtube", "<html>normal 200 page</html>", "unknown"},
		{"netflix", "<meta property=\"og:type\" content=\"video.movie\">{\"countryCode\":\"SG\"}", "unlocked"},
		{"tvb", "{\"allow_in_this_country\":false,\"country\":\"HK\"}", "restricted"},
	} {
		command, e := MediaCommand(c.id, "IPv4")
		require.NoError(t, e)
		require.NotContains(t, command, "curl |")
		require.NotContains(t, command, " -k ")
		ctx, cancel := context.WithTimeout(context.Background(), time.Second*3)
		cmd := exec.CommandContext(ctx, "sh", "-c", command)
		cmd.Env = append(os.Environ(), "PATH="+dir+":"+os.Getenv("PATH"), "NZ_TEST_BODY="+c.body)
		result, e := cmd.CombinedOutput()
		cancel()
		require.NoError(t, e, string(result))
		require.Equal(t, c.want, ClassifyMedia(c.id, "IPv4", string(result), true).Status, string(result))
	}
}

func TestBGPQueryIPv6UsesItsOwnPublicResource(t *testing.T) {
	const ip = "2606:4700:4700::1111"
	var mu sync.Mutex
	resources := []string{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		resources = append(resources, r.URL.Query().Get("resource"))
		mu.Unlock()
		if strings.Contains(r.URL.Path, "as-overview") {
			fmt.Fprint(w, `{"status":"ok","data":{"holder":"Cloudflare"}}`)
			return
		}
		fmt.Fprint(w, `{"status":"ok","data":{"timestamp":"2026-10-06T00:00:00","bgp_state":[{"target_prefix":"2606:4700::/32","source_id":"v6-peer","path":[174,13335]}]}}`)
	}))
	defer srv.Close()
	old := ripeClient
	u, _ := url.Parse(srv.URL)
	ripeClient = &http.Client{Transport: rewriteTransport{u}}
	defer func() { ripeClient = old }()
	got := QueryBGP(context.Background(), ip, "IPv6")
	require.Equal(t, "ok", got.Status)
	require.Equal(t, "IPv6", got.Family)
	require.Equal(t, "2606:4700::/32", got.Prefix)
	require.Equal(t, ip, resources[0])
	require.Equal(t, 1, got.Total)
}
