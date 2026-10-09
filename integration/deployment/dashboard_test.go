//go:build deploymenttest

package deployment

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/nezhahq/nezha/model"
	pb "github.com/nezhahq/nezha/proto"
	"github.com/nezhahq/nezha/service/networkinsight"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
)

type process struct {
	cmd  *exec.Cmd
	done chan error
	log  string
}

// Launch the actual binary against isolated files, never a production endpoint.
func TestDashboardDeploymentLifecycle(t *testing.T) {
	require.NotEmpty(t, os.Getenv("NEZHA_TEST_BINARY"))
	binary, err := filepath.Abs(os.Getenv("NEZHA_TEST_BINARY"))
	require.NoError(t, err)
	root := filepath.Join(t.TempDir(), "Windows 部署 with spaces")
	require.NoError(t, os.MkdirAll(filepath.Join(root, "data"), 0700))
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	address := listener.Addr().String()
	port := listener.Addr().(*net.TCPAddr).Port
	require.NoError(t, listener.Close())
	random := make([]byte, 32)
	_, err = rand.Read(random)
	require.NoError(t, err)
	secret := hex.EncodeToString(random)
	config := fmt.Sprintf("language: en_US\nlisten_host: 127.0.0.1\nlisten_port: %d\nagent_secret_key: %s\njwt_secret_key: %s\ntsdb:\n  data_path: data/tsdb\n  max_memory_mb: 64\n  write_buffer_size: 100000\n  write_buffer_flush_interval: 3600\n", port, secret, secret)
	require.NoError(t, os.WriteFile(filepath.Join(root, "data/config.yaml"), []byte(config), 0600))
	client := &http.Client{Timeout: 5 * time.Second}
	defer client.CloseIdleConnections()
	base := "http://" + address
	start := func(cycle int) *process {
		logPath := filepath.Join(root, fmt.Sprintf("dashboard-%d.log", cycle))
		log, err := os.Create(logPath)
		require.NoError(t, err)
		cmd := exec.Command(binary, "-c", filepath.Join(root, "data/config.yaml"), "-db", filepath.Join(root, "data/sqlite.db"))
		cmd.Dir, cmd.Stdout, cmd.Stderr = root, log, log
		prepareProcess(cmd)
		require.NoError(t, cmd.Start())
		p := &process{cmd: cmd, done: make(chan error, 1), log: logPath}
		go func() { err := cmd.Wait(); _ = log.Close(); p.done <- err; close(p.done) }()
		t.Cleanup(func() {
			select {
			case <-p.done:
			default:
				_ = cmd.Process.Kill()
				select {
				case <-p.done:
				case <-time.After(15 * time.Second):
					t.Error("child did not exit")
				}
			}
		})
		require.Eventually(t, func() bool {
			r, err := client.Get(base + "/api/v1/setting")
			if err != nil {
				return false
			}
			defer r.Body.Close()
			return r.StatusCode == 200
		}, 90*time.Second, 250*time.Millisecond, "Dashboard startup failed; log: %s", logPath)
		return p
	}
	var csrf *http.Cookie
	request := func(method, path, token string, body, out any) {
		var data []byte
		if body != nil {
			data, err = json.Marshal(body)
			require.NoError(t, err)
		}
		req, err := http.NewRequest(method, base+path, bytes.NewReader(data))
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/json")
		if csrf != nil {
			req.AddCookie(csrf)
			req.Header.Set("X-CSRF-Token", csrf.Value)
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, err := client.Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()
		require.Equal(t, 200, resp.StatusCode, path)
		for _, cookie := range resp.Cookies() {
			if cookie.Name == "nz-csrf" {
				csrf = cookie
			}
		}
		var envelope struct {
			Success bool
			Data    json.RawMessage
			Error   string
		}
		require.NoError(t, json.NewDecoder(resp.Body).Decode(&envelope))
		require.True(t, envelope.Success, "%s: %s", path, envelope.Error)
		if out != nil {
			require.NoError(t, json.Unmarshal(envelope.Data, out))
		}
	}
	login := func() string {
		var out struct{ Token string }
		request("POST", "/api/v1/login", "", map[string]string{"username": "admin", "password": "admin"}, &out)
		require.NotEmpty(t, out.Token)
		return out.Token
	}
	checkCommand := func(token string) {
		var rows []struct{ Name, Command string }
		request("GET", "/api/v1/terminal-commands", token, nil, &rows)
		require.Len(t, rows, 1)
		require.Equal(t, "echo native-deployment", rows[0].Command)
	}
	openDB := func() *sql.DB {
		db, err := sql.Open("sqlite3", filepath.Join(root, "data/sqlite.db")+"?mode=ro&_busy_timeout=5000")
		require.NoError(t, err)
		return db
	}
	checkDatabase := func() {
		db := openDB()
		defer db.Close()
		var integrity, ciphertext string
		require.NoError(t, db.QueryRow("PRAGMA integrity_check").Scan(&integrity))
		require.Equal(t, "ok", integrity)
		require.NoError(t, db.QueryRow("SELECT ciphertext FROM terminal_commands").Scan(&ciphertext))
		require.True(t, strings.HasPrefix(ciphertext, "v1:"))
		require.NotContains(t, ciphertext, "native-deployment")
	}
	report := func(cycle int) {
		conn, err := grpc.NewClient(address, grpc.WithTransportCredentials(insecure.NewCredentials()))
		require.NoError(t, err)
		defer conn.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		ctx = metadata.NewOutgoingContext(ctx, metadata.Pairs("client-secret", secret, "client-uuid", "7e6a3847-ad45-405f-a73b-e74c350f1500"))
		agent := pb.NewNezhaServiceClient(conn)
		_, err = agent.ReportSystemInfo2(ctx, &pb.Host{Platform: "windows-test", PlatformVersion: "native", Cpu: []string{"test"}, MemTotal: 1048576, BootTime: 1})
		require.NoError(t, err)
		stream, err := agent.ReportSystemState(ctx)
		require.NoError(t, err)
		for i := 0; i < 3; i++ {
			require.NoError(t, stream.Send(&pb.State{Cpu: float64(cycle + 1), MemUsed: 1024, Uptime: 99, NetInTransfer: uint64(10000 + cycle*100 + i)}))
			receipt, err := stream.Recv()
			require.NoError(t, err)
			require.True(t, receipt.Proced)
		}
		require.NoError(t, stream.CloseSend())
		db := openDB()
		defer db.Close()
		var servers, snapshots int
		require.NoError(t, db.QueryRow("SELECT count(*) FROM servers").Scan(&servers))
		require.Equal(t, 1, servers)
		require.NoError(t, db.QueryRow("SELECT count(*) FROM server_snapshots").Scan(&snapshots))
		require.Positive(t, snapshots)
	}
	returnSnapshotCount := 0
	checkReturnSaved := func(token string) {
		var got struct {
			networkinsight.Snapshot
			History []networkinsight.Snapshot
		}
		request("GET", "/api/v1/server/1/return-route", token, nil, &got)
		require.Equal(t, "complete", got.State)
		require.Len(t, got.Routes, 1)
		require.Equal(t, "reached", got.Routes[0].Status)
		require.Positive(t, got.Routes[0].TestedAt)
		require.InDelta(t, 2.0, *got.Routes[0].Hops[0].RTT, 0.001)
		require.Len(t, got.History, returnSnapshotCount)
	}
	checkReturnFlow := func(token string) {
		var priority struct {
			Order    []string `json:"order"`
			Revision string   `json:"revision"`
		}
		request("GET", "/api/v1/setting/detection-priority", token, nil, &priority)
		priority.Order = []string{"return-route", "bgp", "connectivity", "streaming"}
		request("PUT", "/api/v1/setting/detection-priority", token, priority, &priority)
		var policy struct {
			networkinsight.ReturnPolicy
			Revision string `json:"revision"`
		}
		request("GET", "/api/v1/setting/return-route", token, nil, &policy)
		require.False(t, policy.Enabled)
		require.Len(t, policy.Targets, 9)
		policy.Targets = []networkinsight.ReturnTarget{{ID: "fixture", Name: "北京", Carrier: "电信", IPv4: "1.1.1.1", Enabled: true}}
		request("PUT", "/api/v1/setting/return-route", token, policy, &policy)
		conn, err := grpc.NewClient(address, grpc.WithTransportCredentials(insecure.NewCredentials()))
		require.NoError(t, err)
		defer conn.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		ctx = metadata.NewOutgoingContext(ctx, metadata.Pairs("client-secret", secret, "client-uuid", "7e6a3847-ad45-405f-a73b-e74c350f1500"))
		agent := pb.NewNezhaServiceClient(conn)
		_, err = agent.ReportSystemInfo2(ctx, &pb.Host{Platform: "linux", Arch: "amd64", MemTotal: 1048576, BootTime: 1})
		require.NoError(t, err)
		_, err = agent.ReportGeoIP(ctx, &pb.GeoIP{Ip: &pb.IP{Ipv4: "8.8.8.8"}})
		require.NoError(t, err)
		state, err := agent.ReportSystemState(ctx)
		require.NoError(t, err)
		require.NoError(t, state.Send(&pb.State{Cpu: 1, MemUsed: 1024, Uptime: 99}))
		_, err = state.Recv()
		require.NoError(t, err)
		// A real Agent continuously reports state while automatic tasks wait.
		heartbeatDone := make(chan struct{})
		defer func() { cancel(); <-heartbeatDone }()
		go func() {
			defer close(heartbeatDone)
			ticker := time.NewTicker(5 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					if state.Send(&pb.State{Cpu: 1, MemUsed: 1024, Uptime: 99}) != nil {
						return
					}
					if _, err := state.Recv(); err != nil {
						return
					}
				}
			}
		}()
		tasks, err := agent.RequestTask(ctx)
		require.NoError(t, err)
		require.NoError(t, tasks.Send(&pb.TaskResult{}))
		require.Eventually(t, func() bool {
			var got struct{ Online bool }
			request("GET", "/api/v1/server/1/return-route", token, nil, &got)
			return got.Online
		}, 5*time.Second, 50*time.Millisecond)
		for cycle := 0; cycle < 4; cycle++ {
			endpoint := "/api/v1/server/1/return-route"
			if cycle == 2 {
				endpoint += "/fixture/IPv4"
			}
			if cycle < 3 {
				// Second manual request is immediate: administrators have no cooldown.
				request("POST", endpoint, token, nil, nil)
			} else {
				policy.Enabled = true
				policy.IntervalHours = 5
				request("PUT", "/api/v1/setting/return-route", token, policy, &policy)
			}
			var task *pb.Task
			for {
				task, err = tasks.Recv()
				require.NoError(t, err)
				if task.Type == model.TaskTypeKeepalive {
					require.Zero(t, task.Id)
					require.Empty(t, task.Data)
					continue
				}
				if task.Type == model.TaskTypeCommand && !strings.Contains(task.Data, "nexttrace-tiny") {
					// BGP IPv6 discovery and streaming also use the command namespace.
					require.NotZero(t, task.Id&(uint64(1)<<61))
					require.True(t, strings.Contains(task.Data, "https://api6.ipify.org") || strings.Contains(task.Data, "NZM_UNSUPPORTED"))
					require.NoError(t, tasks.Send(&pb.TaskResult{Id: task.Id, Type: task.Type, Successful: false, Data: "fixture unavailable"}))
					continue
				}
				if task.Type != model.TaskTypeHTTPGet {
					break
				}
				// The default connectivity scheduler shares this Agent stream. Reply
				// to its isolated tasks instead of mistaking them for return probes.
				require.NotZero(t, task.Id&(uint64(1)<<62))
				require.True(t, strings.HasPrefix(task.Data, "https://"))
				require.NoError(t, tasks.Send(&pb.TaskResult{Id: task.Id, Type: task.Type, Successful: true, Delay: 1, Data: "200"}))
			}
			require.Equal(t, uint64(model.TaskTypeCommand), task.Type)
			require.Contains(t, task.Data, "nexttrace-tiny")
			require.Contains(t, task.Data, "-T -p 80 1.1.1.1")
			require.NotContains(t, task.Data, "run.NodeQuality.com")
			// Repeated requests share the current manual OR automatic task.
			for click := 0; click < 5; click++ {
				var current networkinsight.Snapshot
				request("POST", endpoint, token, nil, &current)
				require.Equal(t, "running", current.State)
				if cycle == 2 {
					require.Equal(t, &networkinsight.ReturnSelection{ID: "fixture", Family: "IPv4"}, current.Retest)
					require.Zero(t, current.ScheduledAt)
				}
				if cycle == 3 {
					local := time.Now().In(time.FixedZone("CST", 8*3600))
					want := time.Date(local.Year(), local.Month(), local.Day(), local.Hour()/5*5, 0, 0, 0, local.Location())
					require.Equal(t, want.UnixMilli(), current.ScheduledAt)
				}
			}
			body := "NZR|0\n" + strings.Repeat(" ", 5000) + `{"Hops":[[{"Success":true,"Address":{"IP":"1.1.1.1"},"TTL":1,"RTT":1000000},{"Success":true,"Address":{"IP":"1.1.1.1"},"TTL":1,"RTT":3000000}]]}`
			require.NoError(t, tasks.Send(&pb.TaskResult{Id: task.Id, Type: task.Type, Successful: true, Data: body}))
			require.Eventually(t, func() bool {
				var got networkinsight.Snapshot
				request("GET", "/api/v1/server/1/return-route", token, nil, &got)
				return got.State == "complete"
			}, 5*time.Second, 50*time.Millisecond)
			returnSnapshotCount++
			checkReturnSaved(token)
		}
		var public networkinsight.Snapshot
		request("GET", "/api/v1/server/1/return-route", "", nil, &public)
		require.Empty(t, public.Routes[0].Target)
		require.Empty(t, public.Routes[0].Hops[0].IP)
	}
	appearance := json.RawMessage(`{"version":1,"enabled":true,"features":{"background":{"enabled":true,"desktopLoadEffect":"left","desktopLoadDuration":4.5,"mobileLoadEffect":"zoom","mobileLoadDuration":0.8}}}`)
	checkAppearance := func(token string) {
		var saved struct{ Config json.RawMessage }
		request("GET", "/api/v1/setting/appearance", token, nil, &saved)
		require.JSONEq(t, string(appearance), string(saved.Config))
	}
	p := start(0)
	token := login()
	var appearanceState struct{ Revision string }
	request("GET", "/api/v1/setting/appearance", token, nil, &appearanceState)
	request("PATCH", "/api/v1/setting/appearance", token, map[string]any{"revision": appearanceState.Revision, "config": appearance}, nil)
	checkAppearance(token)
	request("POST", "/api/v1/terminal-commands", token, map[string]string{"name": "native test", "command": "echo native-deployment"}, nil)
	checkCommand(token)
	keyPath := filepath.Join(root, "data/terminal-commands.key")
	key, err := os.ReadFile(keyPath)
	require.NoError(t, err)
	keyHash := sha256.Sum256(key)
	if os.Getenv("NEZHA_TEST_FRONTEND") == "1" {
		for _, path := range []string{"/", "/dashboard/"} {
			resp, err := client.Get(base + path)
			require.NoError(t, err)
			html, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
			require.NoError(t, err)
			require.NoError(t, resp.Body.Close())
			require.Equal(t, 200, resp.StatusCode)
			require.Contains(t, strings.ToLower(string(html)), "<html")
		}
	}
	for cycle := 0; cycle < 3; cycle++ {
		report(cycle)
		if cycle == 0 {
			request("POST", "/api/v1/server/order", token, map[string]any{"server_ids": []uint64{1}}, nil)
			// Older clients must not overwrite manually saved order through editing.
			request("PATCH", "/api/v1/server/1", token, map[string]any{"name": "manual-order-test", "display_index": 999999}, nil)
			response, err := client.Post(base+"/api/v1/server/weights", "application/json", strings.NewReader("{}"))
			require.NoError(t, err)
			require.Equal(t, http.StatusNotFound, response.StatusCode)
			require.NoError(t, response.Body.Close())
			checkReturnFlow(token)
		}
		var weightServers []model.Server
		request("GET", "/api/v1/server", token, nil, &weightServers)
		require.Len(t, weightServers, 1)
		require.Equal(t, uint64(1), weightServers[0].ID)
		require.Equal(t, "7e6a3847-ad45-405f-a73b-e74c350f1500", weightServers[0].UUID)
		require.Equal(t, 1, weightServers[0].DisplayIndex, "manual order persists through edits, restarts and Agent reports")
		checkDatabase()
		if cycle == 0 {
			require.NoError(t, stopProcess(p.cmd))
			select {
			case err := <-p.done:
				require.NoError(t, err)
			case <-time.After(45 * time.Second):
				t.Fatal("graceful shutdown timeout")
			}
			assertShutdown(t, p.log)
		} else {
			require.NoError(t, p.cmd.Process.Kill())
			select {
			case err := <-p.done:
				require.Error(t, err)
			case <-time.After(15 * time.Second):
				t.Fatal("crash simulation timeout")
			}
		}
		p = start(cycle + 1)
		key, err = os.ReadFile(keyPath)
		require.NoError(t, err)
		require.Equal(t, keyHash, sha256.Sum256(key), "restart must preserve key")
		token = login()
		checkAppearance(token)
		checkReturnSaved(token)
		checkCommand(token)
		checkDatabase()
	}
	report(3)
	require.NoError(t, stopProcess(p.cmd))
	select {
	case err := <-p.done:
		require.NoError(t, err)
	case <-time.After(45 * time.Second):
		t.Fatal("final shutdown timeout")
	}
	assertShutdown(t, p.log)
	checkDatabase()
	t.Log("native startup, login, encrypted commands, graceful restart, two crash recoveries, Agent reports and SQLite integrity passed")
}

func assertShutdown(t *testing.T, path string) {
	t.Helper()
	data, err := os.ReadFile(path)
	require.NoError(t, err)
	log := string(data)
	previous := -1
	for _, marker := range []string{"Graceful::REPORT_ADMISSION_CLOSED", "Graceful::AGENT_REPORTS_DRAINED", "Graceful::SERVICE_QUEUE_DRAINED", "Graceful::FINALIZING_STORAGE", "Graceful::REPORTS_PERSISTED_STORAGE_CLOSED", "Graceful::END"} {
		index := strings.Index(log, marker)
		require.Greater(t, index, previous, marker)
		previous = index
	}
	require.NotContains(t, log, "Graceful::INCOMPLETE")
	require.NotContains(t, log, "panic:")
}
