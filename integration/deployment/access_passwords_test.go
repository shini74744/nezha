//go:build deploymenttest

package deployment

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	pb "github.com/nezhahq/nezha/proto"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
)

// Exercise the actual shipped binary, migrations, router and credentials together.
func TestDashboardAccessPasswords(t *testing.T) {
	if os.Getenv("NEZHA_TEST_FRONTEND") != "1" {
		t.Skip("requires packaged frontends; covered by Linux and Windows release verification")
	}
	require.NotEmpty(t, os.Getenv("NEZHA_TEST_BINARY"))
	binary, err := filepath.Abs(os.Getenv("NEZHA_TEST_BINARY"))
	require.NoError(t, err)
	root := t.TempDir()
	require.NoError(t, os.Mkdir(filepath.Join(root, "data"), 0700))
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	address := listener.Addr().String()
	port := listener.Addr().(*net.TCPAddr).Port
	require.NoError(t, listener.Close())
	base := "http://" + address
	back, err := bcrypt.GenerateFromPassword([]byte("fixture-backend"), bcrypt.MinCost)
	require.NoError(t, err)
	front, err := bcrypt.GenerateFromPassword([]byte("fixture-frontend"), bcrypt.MinCost)
	require.NoError(t, err)
	secret := "fixture-access-only-0123456789abcdef"
	config := fmt.Sprintf("language: en_US\nlisten_host: 127.0.0.1\nlisten_port: %d\nweb_real_ip_header: NZ::Use-Peer-IP\nagent_secret_key: %s\njwt_secret_key: %s\nfrontend_password_hash: %s\nbackend_password_hash: %s\nbackend_password_failures: 1\nbackend_password_ban_minutes: 15\ntsdb:\n  data_path: data/tsdb\n  max_memory_mb: 64\n", port, secret, secret, front, back)
	require.NoError(t, os.WriteFile(filepath.Join(root, "data/config.yaml"), []byte(config), 0600))
	jar, err := cookiejar.New(nil)
	require.NoError(t, err)
	client := &http.Client{Jar: jar, Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	defer client.CloseIdleConnections()
	var cmd *exec.Cmd
	var done chan error
	start := func() {
		logfile, err := os.CreateTemp(root, "access-*.log")
		require.NoError(t, err)
		cmd = exec.Command(binary, "-c", filepath.Join(root, "data/config.yaml"), "-db", filepath.Join(root, "data/sqlite.db"))
		cmd.Dir, cmd.Stdout, cmd.Stderr = root, logfile, logfile
		prepareProcess(cmd)
		require.NoError(t, cmd.Start())
		done = make(chan error, 1)
		current := cmd
		channel := done
		go func() { channel <- current.Wait(); logfile.Close() }()
		require.Eventually(t, func() bool {
			r, e := client.Get(base + "/api/v1/setting")
			if e != nil {
				return false
			}
			defer r.Body.Close()
			return r.StatusCode == 200
		}, 60*time.Second, 100*time.Millisecond)
	}
	stop := func() {
		require.NoError(t, stopProcess(cmd))
		select {
		case <-done:
		case <-time.After(20 * time.Second):
			t.Fatal("fixture stop timed out")
		}
		cmd = nil
	}
	defer func() {
		if cmd != nil {
			_ = cmd.Process.Kill()
		}
	}()
	request := func(method, path, body string) (*http.Response, string) {
		req, err := http.NewRequest(method, base+path, strings.NewReader(body))
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		if path == "/api/v1/login" || path == "/api/v1/agent-credentials/issue" || method == "PATCH" {
			req.Header.Set("Content-Type", "application/json")
		}
		u, err := url.Parse(base)
		require.NoError(t, err)
		for _, c := range jar.Cookies(u) {
			if c.Name == "nz-csrf" {
				req.Header.Set("X-CSRF-Token", c.Value)
			}
		}
		resp, err := client.Do(req)
		require.NoError(t, err)
		raw, err := io.ReadAll(resp.Body)
		require.NoError(t, err)
		resp.Body.Close()
		return resp, string(raw)
	}
	start()
	resp, html := request("GET", "/dashboard/profile", "")
	require.Equal(t, 403, resp.StatusCode)
	require.Contains(t, html, "后台访问密码")
	require.NotContains(t, html, "/assets/")
	csrf := regexp.MustCompile(`name="csrf" value="([^"]+)"`).FindStringSubmatch(html)
	require.Len(t, csrf, 2)
	resp, loginBody := request("POST", "/api/v1/login", `{"username":"admin","password":"admin"}`)
	require.Equal(t, 200, resp.StatusCode)
	require.Contains(t, loginBody, `"success":true`)
	resp, profile := request("GET", "/api/v1/profile", "")
	require.Equal(t, 200, resp.StatusCode)
	require.NotContains(t, profile, "agent_secret")
	resp, _ = request("GET", "/api/v1/server", "")
	require.Equal(t, 403, resp.StatusCode)
	resp, _ = request("POST", "/api/v1/backend-auth", url.Values{"password": {"fixture-backend"}, "csrf": {csrf[1]}, "next": {"/dashboard/profile"}}.Encode())
	require.Equal(t, 303, resp.StatusCode)
	require.Equal(t, "/dashboard/profile", resp.Header.Get("Location"))
	resp, html = request("GET", "/dashboard/profile", "")
	require.Equal(t, 200, resp.StatusCode)
	require.Contains(t, html, "/assets/")
	require.Equal(t, "no-store", resp.Header.Get("Cache-Control"))
	resp, profile = request("GET", "/api/v1/profile", "")
	require.Equal(t, 200, resp.StatusCode)
	require.Contains(t, profile, "agent_secret")
	resp, settings := request("GET", "/api/v1/setting/access-passwords", "")
	require.Equal(t, 200, resp.StatusCode)
	require.Contains(t, settings, `"backend_password_required":true`)
	resp, _ = request("GET", "/api/v1/server", "")
	require.Equal(t, 200, resp.StatusCode)
	u, err := url.Parse(base)
	require.NoError(t, err)

	// New Agents must obtain their own registered pair, not an account-wide key.
	resp, pairBody := request("POST", "/api/v1/agent-credentials/issue", "{}")
	require.Equal(t, 200, resp.StatusCode)
	var pairResponse struct {
		Success bool
		Data    struct {
			UUID   string `json:"uuid"`
			Secret string `json:"client_secret"`
		}
	}
	require.NoError(t, json.Unmarshal([]byte(pairBody), &pairResponse))
	require.True(t, pairResponse.Success)
	require.NotEmpty(t, pairResponse.Data.Secret)

	// Configure independent schedules via the real authenticated management route.
	originalCookies := jar.Cookies(u)
	now := time.Now().In(time.FixedZone("Beijing", 8*3600))
	freeStart, freeEnd := now.Add(6*time.Hour).Format("15:04"), now.Add(7*time.Hour).Format("15:04")
	patch := fmt.Sprintf(`{"frontend_password_schedule":{"enabled":true,"start":"%s","end":"%s"},"backend_password_schedule":{"enabled":true,"start":"%s","end":"%s"}}`, freeStart, freeEnd, freeStart, freeEnd)
	resp, settings = request("PATCH", "/api/v1/setting/access-passwords", patch)
	require.Equal(t, 200, resp.StatusCode)
	require.Contains(t, settings, `"success":true`)
	require.Empty(t, resp.Cookies(), "changing schedule must not mint a verification credential")
	jar.SetCookies(u, []*http.Cookie{{Name: "nz-backend-auth", Path: "/", MaxAge: -1}})
	resp, _ = request("GET", "/dashboard/profile", "")
	require.Equal(t, 200, resp.StatusCode)
	resp, _ = request("GET", "/api/v1/server", "")
	require.Equal(t, 200, resp.StatusCode)
	resp, profile = request("GET", "/api/v1/profile", "")
	require.Contains(t, profile, "agent_secret")
	for _, route := range []string{"/api/v1/backend-auth", "/api/v1/frontend-auth"} {
		resp, _ = request("POST", route, "password=incorrect")
		require.Equal(t, 303, resp.StatusCode)
		require.Empty(t, resp.Cookies(), "free period must never mint access cookies")
	}
	resp, html = request("GET", "/", "")
	require.NotContains(t, html, "访问密码</h1>")
	// Free access-password periods never replace account authentication.
	anonymous, err := http.Get(base + "/api/v1/server")
	require.NoError(t, err)
	anonymousBody, err := io.ReadAll(anonymous.Body)
	anonymous.Body.Close()
	require.NoError(t, err)
	require.NotContains(t, string(anonymousBody), `"success":true`)
	// Re-enabling all-day protection applies immediately, without restarting.
	resp, settings = request("PATCH", "/api/v1/setting/access-passwords", `{"frontend_password_schedule":{"enabled":false,"start":"22:00","end":"07:00"},"backend_password_schedule":{"enabled":false,"start":"09:00","end":"18:00"}}`)
	require.Equal(t, 200, resp.StatusCode)
	require.Contains(t, settings, `"success":true`)
	resp, _ = request("GET", "/api/v1/server", "")
	require.Equal(t, 403, resp.StatusCode)
	resp, html = request("GET", "/", "")
	require.Contains(t, html, "前台访问密码")
	jar.SetCookies(u, originalCookies)
	stop()
	start()
	resp, settings = request("GET", "/api/v1/setting/access-passwords", "")
	require.Equal(t, 200, resp.StatusCode)
	require.Contains(t, settings, `"frontend_password_schedule":{"enabled":false,"start":"22:00","end":"07:00"}`)
	require.Contains(t, settings, `"backend_password_schedule":{"enabled":false,"start":"09:00","end":"18:00"}`)

	jar.SetCookies(u, []*http.Cookie{{Name: "nz-backend-auth", Path: "/", MaxAge: -1}})
	resp, html = request("GET", "/dashboard/", "")
	require.Equal(t, 403, resp.StatusCode)
	csrf = regexp.MustCompile(`name="csrf" value="([^"]+)"`).FindStringSubmatch(html)
	require.Len(t, csrf, 2)
	resp, _ = request("POST", "/api/v1/backend-auth", url.Values{"password": {"bad"}, "csrf": {csrf[1]}}.Encode())
	require.Equal(t, 429, resp.StatusCode)
	resp, _ = request("GET", "/api/v1/server", "")
	require.Equal(t, 429, resp.StatusCode)
	stop()
	start()
	resp, html = request("GET", "/dashboard/", "")
	require.Equal(t, 429, resp.StatusCode)
	require.Contains(t, html, "禁止访问后台")
	resp, html = request("GET", "/", "")
	require.Equal(t, 200, resp.StatusCode)
	require.Contains(t, html, "前台访问密码")
	resp, _ = request("POST", "/api/v1/frontend-auth", url.Values{"password": {"fixture-frontend"}}.Encode())
	require.Equal(t, 303, resp.StatusCode)
	resp, html = request("GET", "/", "")
	require.Equal(t, 200, resp.StatusCode)
	require.NotContains(t, html, "访问密码</h1>")
	conn, err := grpc.NewClient(address, grpc.WithTransportCredentials(insecure.NewCredentials()))
	require.NoError(t, err)
	defer conn.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ctx = metadata.NewOutgoingContext(ctx, metadata.Pairs("client-secret", pairResponse.Data.Secret, "client-uuid", pairResponse.Data.UUID))
	_, err = pb.NewNezhaServiceClient(conn).ReportSystemInfo2(ctx, &pb.Host{Platform: "linux", PlatformVersion: "fixture", Cpu: []string{"fixture"}, MemTotal: 1048576, BootTime: 1})
	require.NoError(t, err, "backend IP ban must not block Agent reports")
	stop()
}
