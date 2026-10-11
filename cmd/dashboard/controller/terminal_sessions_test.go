package controller

import (
	"context"
	"encoding/base64"
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/terminalsession"
	"github.com/nezhahq/nezha/service/rpc"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func sessionFixture(t *testing.T) *managedTerminal {
	cleanup, _ := setupMCPTest(t)
	db, _ := singleton.DB.DB()
	db.SetMaxOpenConns(1)
	require.NoError(t, singleton.DB.AutoMigrate(&model.TerminalSession{}, &model.TerminalSessionEvent{}))
	server, _ := singleton.ServerShared.Get(7)
	server.UUID = "terminal-owned-uuid"
	m := &managedTerminal{ID: "managed-fixture", UserID: 100, ServerID: 7, ServerOwner: 100, ServerUUID: server.UUID, Role: model.RoleMember, Name: "test", Kind: "native", Created: time.Now(), Bridge: terminalsession.New(), Handler: rpc.NewNezhaHandler()}
	require.NoError(t, m.Handler.CreateStreamWithPurpose(m.ID, 100, 7, rpc.PurposeTerminal))
	managedTerminals.Lock()
	managedTerminals.rows[m.ID] = m
	managedTerminals.Unlock()
	t.Cleanup(func() { m.close(); cleanup() })
	return m
}
func sessionRequestContext(t *testing.T, body any) *gin.Context {
	return newAuthorizedControllerContext(t, "POST", "/terminal-sessions", body)
}
func TestManagedTerminalKeepMetadataHistoryAndPermissions(t *testing.T) {
	m := sessionFixture(t)
	form := map[string]any{"stream_id": m.ID, "enabled": true}
	view, e := keepTerminalSession(sessionRequestContext(t, form))
	require.NoError(t, e)
	require.True(t, view.Keep)
	require.NotZero(t, view.RecordID)
	var row model.TerminalSession
	require.NoError(t, singleton.DB.First(&row, view.RecordID).Error)
	require.Equal(t, m.ServerUUID, row.ServerUUID)
	require.Equal(t, "held", row.Status)
	var events []model.TerminalSessionEvent
	require.NoError(t, singleton.DB.Find(&events).Error)
	require.Len(t, events, 1)
	require.Equal(t, "keep", events[0].Action)
	foreign := sessionRequestContext(t, form)
	foreign.Set(model.CtxKeyAuthorizedUser, &model.User{Common: model.Common{ID: 101}, Role: model.RoleAdmin})
	_, e = keepTerminalSession(foreign)
	require.Error(t, e)
	pat := sessionRequestContext(t, form)
	pat.Set(model.CtxKeyAPIToken, &model.APIToken{})
	_, e = keepTerminalSession(pat)
	require.Error(t, e)
	form["enabled"] = false
	view, e = keepTerminalSession(sessionRequestContext(t, form))
	require.NoError(t, e)
	require.False(t, view.Keep)
	_, e = stopNativeTerminal(sessionRequestContext(t, map[string]any{"stream_id": m.ID}))
	require.Error(t, e)
	_, e = stopNativeTerminal(sessionRequestContext(t, map[string]any{"stream_id": m.ID, "confirm": true}))
	require.NoError(t, e)
	require.Nil(t, managedLookup(m.ID))
}
func TestManagedKeepDatabaseFailureDoesNotClaimPersistence(t *testing.T) {
	m := sessionFixture(t)
	require.NoError(t, singleton.DB.Migrator().DropTable(&model.TerminalSessionEvent{}))
	_, e := keepTerminalSession(sessionRequestContext(t, map[string]any{"stream_id": m.ID, "enabled": true}))
	require.Error(t, e)
	require.False(t, m.Keep)
	require.Zero(t, m.RowID)
	var count int64
	require.NoError(t, singleton.DB.Model(&model.TerminalSession{}).Count(&count).Error)
	require.Zero(t, count)
}
func TestManagedOriginAndIdentityRevocation(t *testing.T) {
	m := sessionFixture(t)
	c := sessionRequestContext(t, nil)
	c.Request.Header.Set("Origin", "https://foreign.example")
	_, e := managedTerminalStream(c, m)
	require.Error(t, e)
	require.Same(t, m, managedLookup(m.ID))
	require.False(t, m.Bridge.Attached())
	require.NoError(t, singleton.DB.Model(&model.User{}).Where("id = ?", 100).Update("token_version", 1).Error)
	require.False(t, m.valid())
	_, e = managedForRequest(sessionRequestContext(t, nil), m.ID)
	require.Error(t, e)
}
func TestManagedWebSocketSurvivesBrowserCloseAndResumes(t *testing.T) {
	m := sessionFixture(t)
	m.Keep = true
	previous := upgrader
	upgrader = &websocket.Upgrader{CheckOrigin: checkSameOrigin}
	defer func() { upgrader = previous }()
	r := gin.New()
	r.GET("/ws", func(c *gin.Context) { _, _ = managedTerminalStream(c, m) })
	srv := httptest.NewServer(r)
	defer srv.Close()
	dial := func() *websocket.Conn {
		ws, _, e := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http")+"/ws", http.Header{"Origin": {srv.URL}})
		require.NoError(t, e)
		return ws
	}
	first := dial()
	require.NoError(t, first.WriteMessage(websocket.TextMessage, []byte("hello")))
	b := make([]byte, 20)
	n, e := m.Bridge.Read(b)
	require.NoError(t, e)
	require.Equal(t, "\x00hello", string(b[:n]))
	_, resp, e := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http")+"/ws", http.Header{"Origin": {srv.URL}})
	require.Error(t, e)
	if resp != nil {
		resp.Body.Close()
	}
	require.NoError(t, first.Close())
	require.Eventually(t, func() bool { return !m.Bridge.Attached() }, time.Second, 10*time.Millisecond)
	_, e = m.Bridge.Write([]byte("task still running"))
	require.NoError(t, e)
	second := dial()
	defer second.Close()
	_ = second.SetReadDeadline(time.Now().Add(time.Second))
	_, out, e := second.ReadMessage()
	require.NoError(t, e)
	require.Equal(t, "task still running", string(out))
	require.NoError(t, second.Close())
	require.Eventually(t, func() bool { return !m.Bridge.Attached() }, time.Second, 10*time.Millisecond)
	require.Same(t, m, managedLookup(m.ID))
}
func TestTmuxDiscoveryTracksExternalAndCreatedWindows(t *testing.T) {
	m := sessionFixture(t)
	s, _ := singleton.ServerShared.Get(7)
	created := model.TerminalSession{Common: model.Common{UserID: 100}, ServerID: 7, ServerUUID: m.ServerUUID, Kind: "tmux", RemoteID: "$2", RemoteCreated: "99", Source: "panel", CreatedWindowName: "original"}
	require.NoError(t, singleton.DB.Create(&created).Error)
	remotes := []terminalsession.Tmux{{ID: "$1", Created: "88", Name: "manual", Windows: []terminalsession.Window{{ID: "@1", Name: "manual window"}}}, {ID: "$2", Created: "99", Name: "created", Windows: []terminalsession.Window{{ID: "@2", Name: "renamed"}}}}
	rows, e := syncTmuxRecords(100, s, remotes)
	require.NoError(t, e)
	require.Len(t, rows, 2)
	require.Equal(t, "existing", rows[0].Source)
	require.Equal(t, "panel", rows[1].Source)
	require.Equal(t, "original", rows[1].CreatedWindowName)
	require.Equal(t, "renamed", rows[1].Windows[0].Name)
	rows, e = syncTmuxRecords(101, s, remotes)
	require.NoError(t, e)
	require.NotEqual(t, created.ID, rows[1].ID)
	rows, e = syncTmuxRecords(100, s, remotes[:1])
	require.NoError(t, e)
	require.Len(t, rows, 1)
	require.NoError(t, singleton.DB.First(&created, created.ID).Error)
	require.Equal(t, "closed", created.Status)
}
func TestTmuxFailedScanDoesNotDeleteRecordsAndWrongOwnerCannotAttach(t *testing.T) {
	m := sessionFixture(t)
	s, _ := singleton.ServerShared.Get(7)
	old := runTmuxCommand
	defer func() { runTmuxCommand = old }()
	raw := "NZX_OK\nS|$1|88|" + base64.StdEncoding.EncodeToString([]byte("manual\n")) + "\nW|$1|@1|0|bWFpbgo=\nNZX_END"
	runTmuxCommand = func(context.Context, *model.Server, string) (string, error) { return raw, nil }
	result, e := listTerminalSessions(sessionRequestContext(t, map[string]any{"server_id": 7}))
	require.NoError(t, e)
	require.Len(t, result.Tmux, 1)
	runTmuxCommand = func(context.Context, *model.Server, string) (string, error) { return "", errors.New("offline") }
	result, e = listTerminalSessions(sessionRequestContext(t, map[string]any{"server_id": 7}))
	require.NoError(t, e)
	require.Contains(t, result.TmuxError, "offline")
	var row model.TerminalSession
	require.NoError(t, singleton.DB.Where("server_uuid = ? AND kind = ?", m.ServerUUID, "tmux").First(&row).Error)
	require.Equal(t, "available", row.Status)
	c := sessionRequestContext(t, tmuxActionForm{ServerID: s.ID, RecordID: row.ID})
	c.Set(model.CtxKeyAuthorizedUser, &model.User{Common: model.Common{ID: 101}, Role: model.RoleAdmin})
	_, e = attachTmuxSession(c)
	require.Error(t, e)
}
func TestTmuxInstallFailureReasonsAndConfirmation(t *testing.T) {
	sessionFixture(t)
	_, e := installTmux(sessionRequestContext(t, map[string]any{"server_id": 7}))
	require.Error(t, e)
	for code, part := range map[string]string{"NZX_DNS": "DNS", "NZX_NETWORK": "网络", "NZX_PERMISSION": "权限", "NZX_LOCK": "占用", "NZX_DISK": "空间", "NZX_REPOSITORY": "软件源", "NZX_TIMEOUT": "5 分钟"} {
		v := installResult(code, nil)
		require.Equal(t, "failed", v.State)
		require.Contains(t, v.Message, part)
	}
	require.Equal(t, "done", installResult("NZX_INSTALLED", nil).State)
	require.Equal(t, "failed", installResult("untrusted logs with password", nil).State)
	require.NotContains(t, installResult("untrusted logs with password", nil).Message, "password")
}

func TestManagedStrictBrowserOrigin(t *testing.T) {
	for _, origin := range []string{"", "null", "http://other.example", "ftp://panel.example", "http://panel.example/", "http://panel.example?x=1"} {
		r := httptest.NewRequest("GET", "http://panel.example/ws", nil)
		r.Header.Set("Origin", origin)
		require.False(t, terminalSessionOrigin(r), origin)
	}
	r := httptest.NewRequest("GET", "http://panel.example/ws", nil)
	r.Header.Set("Origin", "http://panel.example")
	require.True(t, terminalSessionOrigin(r))
	r.Header.Set("X-Forwarded-Proto", "https")
	require.False(t, terminalSessionOrigin(r))
	r.Header.Set("Origin", "https://panel.example")
	require.True(t, terminalSessionOrigin(r))
}

func TestManagedActualRPCBridgeDetachedInputOutput(t *testing.T) {
	fixture := sessionFixture(t)
	previous := rpc.NezhaHandlerSingleton
	rpc.NezhaHandlerSingleton = rpc.NewNezhaHandler()
	defer func() { rpc.NezhaHandlerSingleton = previous }()
	server, _ := singleton.ServerShared.Get(7)
	agent := &tgEchoStream{handler: rpc.NezhaHandlerSingleton}
	server.SetTaskStream(agent)
	response, e := createTerminal(sessionRequestContext(t, model.TerminalForm{ServerID: 7, Protocol: "session-v1"}))
	require.NoError(t, e)
	m := managedLookup(response.SessionID)
	require.NotNil(t, m)
	defer func() { m.close(); m.Workers.Wait() }()
	require.NotEqual(t, fixture.ID, m.ID)
	require.EqualValues(t, 1, agent.count.Load())
	_, e = keepTerminalSession(sessionRequestContext(t, map[string]any{"stream_id": m.ID, "enabled": true}))
	require.NoError(t, e)
	a, e := m.Bridge.Attach()
	require.NoError(t, e)
	require.NoError(t, m.Bridge.Send(a, []byte{0, 'h', 'i'}))
	select {
	case b := <-a.Output:
		require.Equal(t, []byte{0, 'h', 'i'}, b)
	case <-time.After(time.Second):
		t.Fatal("relay failed")
	}
	m.Bridge.Detach(a)
	require.NoError(t, m.Bridge.Send(nil, []byte{0, 'o', 'k'}))
	time.Sleep(20 * time.Millisecond)
	next, e := m.Bridge.Attach()
	require.NoError(t, e)
	select {
	case b := <-next.Output:
		require.Contains(t, string(b), "ok")
	case <-time.After(time.Second):
		t.Fatal("detached output lost")
	}
	require.True(t, m.valid())
}

func TestTmuxCreateRecordsRequestedWindowAndEndRequiresConfirmation(t *testing.T) {
	sessionFixture(t)
	previous := rpc.NezhaHandlerSingleton
	rpc.NezhaHandlerSingleton = rpc.NewNezhaHandler()
	defer func() { rpc.NezhaHandlerSingleton = previous }()
	s, _ := singleton.ServerShared.Get(7)
	s.SetTaskStream(&tgEchoStream{handler: rpc.NezhaHandlerSingleton})
	old := runTmuxCommand
	defer func() { runTmuxCommand = old }()
	calls := 0
	runTmuxCommand = func(_ context.Context, _ *model.Server, command string) (string, error) {
		calls++
		if strings.Contains(command, "new-session") {
			return "$1|99\n", nil
		}
		if strings.Contains(command, "kill-session") {
			return "", nil
		}
		return "NZX_OK\nS|$1|99|YnVpbGQK\nW|$1|@1|0|bWFpbgo=\nNZX_END", nil
	}
	view, e := createTmuxSession(sessionRequestContext(t, tmuxActionForm{ServerID: 7, Name: "build", Window: "main"}))
	require.NoError(t, e)
	m := managedLookup(view.SessionID)
	require.NotNil(t, m)
	defer func() { m.close(); m.Workers.Wait() }()
	var row model.TerminalSession
	require.NoError(t, singleton.DB.First(&row, view.RecordID).Error)
	require.Equal(t, "build", row.Name)
	require.Equal(t, "main", row.CreatedWindowName)
	require.Equal(t, "panel", row.Source)
	before := calls
	_, e = endTmuxSession(sessionRequestContext(t, tmuxActionForm{ServerID: 7, RecordID: row.ID}))
	require.Error(t, e)
	require.Equal(t, before, calls)
	_, e = endTmuxSession(sessionRequestContext(t, tmuxActionForm{ServerID: 7, RecordID: row.ID, Confirm: true}))
	require.NoError(t, e)
	require.NoError(t, singleton.DB.First(&row, row.ID).Error)
	require.Equal(t, "closed", row.Status)
	var events []model.TerminalSessionEvent
	require.NoError(t, singleton.DB.Where("session_id = ?", row.ID).Order("id").Find(&events).Error)
	require.Equal(t, []string{"create_requested", "created", "end_requested", "ended"}, []string{events[0].Action, events[1].Action, events[2].Action, events[3].Action})
}
func TestTmuxInstallCoalescesClicksAndRetainsResult(t *testing.T) {
	m := sessionFixture(t)
	s, _ := singleton.ServerShared.Get(7)
	s.SetTaskStream(&failingRequestTaskStream{})
	tmuxInstalls.Lock()
	delete(tmuxInstalls.rows, m.ServerUUID)
	tmuxInstalls.Unlock()
	old := runTmuxInstall
	defer func() {
		runTmuxInstall = old
		tmuxInstalls.Lock()
		delete(tmuxInstalls.rows, m.ServerUUID)
		tmuxInstalls.Unlock()
	}()
	started := make(chan struct{}, 2)
	finish := make(chan struct{})
	runTmuxInstall = func(ctx context.Context, _ *model.Server, script string) (string, error) {
		started <- struct{}{}
		select {
		case <-finish:
			return "NZX_INSTALLED", nil
		case <-ctx.Done():
			return "", ctx.Err()
		}
	}
	form := map[string]any{"server_id": 7, "confirm": true}
	v, e := installTmux(sessionRequestContext(t, form))
	require.NoError(t, e)
	require.Equal(t, "running", v.State)
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("installer not started")
	}
	v, e = installTmux(sessionRequestContext(t, form))
	require.NoError(t, e)
	require.Equal(t, "running", v.State)
	require.Empty(t, started)
	close(finish)
	require.Eventually(t, func() bool {
		v, e := tmuxInstallStatus(sessionRequestContext(t, form))
		return e == nil && v.State == "done"
	}, time.Second, 10*time.Millisecond)
}

func TestManagedDisableKeepContinuesUntilBrowserCloses(t *testing.T) {
	m := sessionFixture(t)
	previous := upgrader
	upgrader = &websocket.Upgrader{CheckOrigin: checkSameOrigin}
	defer func() { upgrader = previous }()
	_, err := keepTerminalSession(sessionRequestContext(t, map[string]any{"stream_id": m.ID, "enabled": true}))
	require.NoError(t, err)
	done := make(chan struct{})
	r := gin.New()
	r.GET("/ws", func(c *gin.Context) { defer close(done); _, _ = managedTerminalStream(c, m) })
	srv := httptest.NewServer(r)
	defer srv.Close()
	ws, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http")+"/ws", http.Header{"Origin": {srv.URL}})
	require.NoError(t, err)
	defer ws.Close()
	view, err := keepTerminalSession(sessionRequestContext(t, map[string]any{"stream_id": m.ID, "enabled": false}))
	require.NoError(t, err)
	require.False(t, view.Keep)
	require.True(t, m.Bridge.Attached())
	require.Same(t, m, managedLookup(m.ID))
	_, err = m.Bridge.Write([]byte("still running"))
	require.NoError(t, err)
	require.NoError(t, ws.SetReadDeadline(time.Now().Add(time.Second)))
	_, output, err := ws.ReadMessage()
	require.NoError(t, err)
	require.Equal(t, "still running", string(output))
	require.NoError(t, ws.Close())
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("terminal did not close after browser disconnected")
	}
	require.Nil(t, managedLookup(m.ID))
	select {
	case <-m.Bridge.Done():
	default:
		t.Fatal("agent bridge remains open")
	}
}
