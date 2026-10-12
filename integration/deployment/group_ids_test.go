//go:build deploymenttest

package deployment

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/tsdb"
	"github.com/stretchr/testify/require"
)

func TestDashboardGroupAndServerIDMaintenance(t *testing.T) {
	binary, err := filepath.Abs(os.Getenv("NEZHA_TEST_BINARY"))
	require.NoError(t, err)
	root := t.TempDir()
	require.NoError(t, os.Mkdir(filepath.Join(root, "data"), 0700))
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	port := listener.Addr().(*net.TCPAddr).Port
	require.NoError(t, listener.Close())
	base := fmt.Sprintf("http://127.0.0.1:%d", port)
	config := fmt.Sprintf("language: en_US\nlisten_host: 127.0.0.1\nlisten_port: %d\nagent_secret_key: fixture-id-maintenance-only-0123456789abcdef\njwt_secret_key: fixture-id-maintenance-only-0123456789abcdef\ntsdb:\n  data_path: data/tsdb\n  max_memory_mb: 64\n", port)
	require.NoError(t, os.WriteFile(filepath.Join(root, "data/config.yaml"), []byte(config), 0600))
	client := &http.Client{Timeout: 30 * time.Second}
	defer client.CloseIdleConnections()
	var csrf *http.Cookie
	var cmd *exec.Cmd
	var done chan error
	var logfile *os.File
	start := func() {
		logfile, err = os.CreateTemp(root, "process-*.log")
		require.NoError(t, err)
		cmd = exec.Command(binary, "-c", filepath.Join(root, "data/config.yaml"), "-db", filepath.Join(root, "data/sqlite.db"))
		cmd.Dir, cmd.Stdout, cmd.Stderr = root, logfile, logfile
		prepareProcess(cmd)
		require.NoError(t, cmd.Start())
		logPath := logfile.Name()
		t.Cleanup(func() {
			if t.Failed() {
				raw, _ := os.ReadFile(logPath)
				t.Log(string(raw))
			}
		})
		done = make(chan error, 1)
		current := cmd
		go func() { done <- current.Wait() }()
		require.Eventually(t, func() bool {
			resp, e := client.Get(base + "/api/v1/setting")
			if e != nil {
				return false
			}
			defer resp.Body.Close()
			for _, cookie := range resp.Cookies() {
				if cookie.Name == "nz-csrf" {
					csrf = cookie
				}
			}
			return resp.StatusCode == 200
		}, 60*time.Second, 100*time.Millisecond, "process log: %s", logfile.Name())
	}
	stop := func() {
		require.NoError(t, stopProcess(cmd))
		select {
		case <-done:
		case <-time.After(20 * time.Second):
			t.Fatal("stop timeout")
		}
		require.NoError(t, logfile.Close())
		cmd = nil
	}
	defer func() {
		if cmd != nil {
			_ = cmd.Process.Kill()
			_ = logfile.Close()
		}
	}()
	request := func(method, path, token string, body, out any) string {
		raw, e := json.Marshal(body)
		require.NoError(t, e)
		req, e := http.NewRequest(method, base+path, bytes.NewReader(raw))
		require.NoError(t, e)
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		if csrf != nil {
			req.AddCookie(csrf)
			req.Header.Set("X-CSRF-Token", csrf.Value)
		}
		resp, e := client.Do(req)
		require.NoError(t, e)
		defer resp.Body.Close()
		for _, cookie := range resp.Cookies() {
			if cookie.Name == "nz-csrf" {
				csrf = cookie
			}
		}
		require.Equal(t, 200, resp.StatusCode, path)
		var result struct {
			Success bool
			Error   string
			Data    json.RawMessage
		}
		require.NoError(t, json.NewDecoder(resp.Body).Decode(&result))
		if result.Error != "" {
			return result.Error
		}
		require.True(t, result.Success, path)
		if out != nil {
			require.NoError(t, json.Unmarshal(result.Data, out))
		}
		return ""
	}
	login := func() string {
		var result struct{ Token string }
		require.Empty(t, request("POST", "/api/v1/login", "", map[string]string{"username": "admin", "password": "admin"}, &result))
		return result.Token
	}
	start()
	stop()
	db, err := sql.Open("sqlite3", filepath.Join(root, "data/sqlite.db"))
	require.NoError(t, err)
	for _, server := range []struct {
		id         uint64
		name, uuid string
		position   int
	}{{47, "second", "fixture-server-47", 1}, {63, "first", "fixture-server-63", 2}} {
		_, err = db.Exec("INSERT INTO servers (id,name,uuid,user_id,display_index) VALUES (?,?,?,1,?)", server.id, server.name, server.uuid, server.position)
		require.NoError(t, err)
	}
	_, err = db.Exec("INSERT INTO server_groups (id,name,user_id,created_at,updated_at) VALUES (6,'legacy',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
	require.NoError(t, err)
	for _, id := range []uint64{47, 63} {
		_, err = db.Exec("INSERT INTO server_group_servers (server_group_id,server_id) VALUES (6,?)", id)
		require.NoError(t, err)
	}
	_, err = db.Exec("INSERT INTO terminal_sessions (server_id,server_uuid,name,kind) VALUES (63,'fixture-server-63','keep','tmux')")
	require.NoError(t, err)
	require.NoError(t, db.Close())
	// Seed durable input, then verify the real API's self-restart persists the
	// newly remapped samples rather than merely updating SQLite IDs.
	metricsConfig := &tsdb.Config{DataPath: filepath.Join(root, "data/tsdb"),
		RetentionDays: 30, MaxMemoryMB: 64, DedupInterval: 30 * time.Second}
	metrics, err := tsdb.Open(metricsConfig)
	require.NoError(t, err)
	at := time.Now().Add(-10 * time.Minute)
	for _, id := range []uint64{47, 63} {
		for index := 0; index < 10; index++ {
			require.NoError(t, metrics.WriteServerMetrics(&tsdb.ServerMetrics{
				ServerID: id, Timestamp: at.Add(time.Duration(index) * time.Minute),
				CPU: float64(id), MemUsed: id * 1024, DiskUsed: id * 1024 * 1024}))
			require.NoError(t, metrics.WriteServiceMetrics(&tsdb.ServiceMetrics{
				ServerID: id, ServiceID: 7, Timestamp: at.Add(time.Duration(index) * time.Minute),
				Delay: float64(id), Successful: true}))
		}
	}
	require.NoError(t, metrics.Close())
	start()
	token := login()
	var groups []model.ServerGroupResponseItem
	readGroups := func() { require.Empty(t, request("GET", "/api/v1/server-group", token, nil, &groups)) }
	readGroups()
	require.Len(t, groups, 1)
	require.Equal(t, uint64(1), groups[0].Group.ID, "startup must normalize legacy group ID 6")
	require.ElementsMatch(t, []uint64{47, 63}, groups[0].Servers)
	for _, name := range []string{"second-group", "third-group"} {
		var id uint64
		require.Empty(t, request("POST", "/api/v1/server-group", token, model.ServerGroupForm{Name: name, Servers: []uint64{63}}, &id))
	}
	readGroups()
	require.Len(t, groups, 3)
	oldRevision := groups[0].Revision
	query, _ := json.Marshal(map[uint64]string{1: oldRevision})
	deletePath := "/api/v1/batch-delete/server-group?revisions=" + url.QueryEscape(string(query))
	require.Empty(t, request("POST", deletePath, token, []uint64{1}, nil))
	require.Contains(t, request("POST", deletePath, token, []uint64{1}, nil), "刷新")
	require.Contains(t, request("PATCH", "/api/v1/server-group/1", token, model.ServerGroupForm{Name: "wrong", Servers: []uint64{63}, Revision: oldRevision}, nil), "刷新")
	readGroups()
	require.Equal(t, []uint64{1, 2}, []uint64{groups[0].Group.ID, groups[1].Group.ID})
	require.Equal(t, "second-group", groups[0].Group.Name)
	require.Empty(t, request("PATCH", "/api/v1/server-group/1", token, model.ServerGroupForm{Name: "edited", Servers: []uint64{47, 63}, Revision: groups[0].Revision}, nil))
	require.Empty(t, request("POST", "/api/v1/server/reassign-ids", token, map[string]any{"server_ids": []uint64{63, 47}}, nil))
	select {
	case <-done:
	case <-time.After(30 * time.Second):
		t.Fatal("reassignment did not restart")
	}
	require.NoError(t, logfile.Close())
	cmd = nil
	restartLog, err := os.ReadFile(logfile.Name())
	require.NoError(t, err)
	require.Contains(t, string(restartLog), "Graceful::REPORTS_PERSISTED_STORAGE_CLOSED",
		"ID reassignment must close storage before exiting")
	metrics, err = tsdb.Open(metricsConfig)
	require.NoError(t, err)
	for oldID, newID := range map[uint64]uint64{63: 1, 47: 2} {
		points, err := metrics.QueryServerMetrics(newID, tsdb.MetricServerCPU, tsdb.Period1Day)
		require.NoError(t, err)
		require.NotEmpty(t, points, "restarted history missing for old ID %d", oldID)
		for _, point := range points {
			require.Equal(t, float64(oldID), point.Value)
		}
		services, err := metrics.QueryServiceHistoryByServerID(newID, tsdb.Period1Day)
		require.NoError(t, err)
		require.NotEmpty(t, services[7], "restarted service history missing for old ID %d", oldID)
	}
	require.NoError(t, metrics.Close())
	start()
	token = login()
	var servers []model.Server
	require.Empty(t, request("GET", "/api/v1/server", token, nil, &servers))
	require.Len(t, servers, 2)
	require.Equal(t, uint64(1), servers[0].ID)
	require.Equal(t, "fixture-server-63", servers[0].UUID)
	require.Equal(t, uint64(2), servers[1].ID)
	require.Equal(t, "fixture-server-47", servers[1].UUID)
	readGroups()
	require.Equal(t, "edited", groups[0].Group.Name)
	require.ElementsMatch(t, []uint64{1, 2}, groups[0].Servers)
	stop()
	db, err = sql.Open("sqlite3", filepath.Join(root, "data/sqlite.db")+"?mode=ro")
	require.NoError(t, err)
	defer db.Close()
	var id uint64
	require.NoError(t, db.QueryRow("SELECT server_id FROM terminal_sessions WHERE server_uuid='fixture-server-63'").Scan(&id))
	require.Equal(t, uint64(1), id)
	var count int
	require.NoError(t, db.QueryRow("SELECT count(*) FROM server_operation_logs WHERE action='reassign_ids'").Scan(&count))
	require.Equal(t, 2, count)
	var integrity string
	require.NoError(t, db.QueryRow("PRAGMA integrity_check").Scan(&integrity))
	require.Equal(t, "ok", integrity)
}
