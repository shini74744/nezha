package controller

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/rpc"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
)

func tgUIBody(method, path string, data any) any {
	return map[string]any{"method": method, "path": path, "data": data}
}
func TestTelegramUIAllowlistOwnershipAndExpiry(t *testing.T) {
	r, n := tgFixture(t)
	require.NoError(t, singleton.DB.AutoMigrate(&model.TerminalSession{}, &model.TerminalSessionEvent{}, &model.TerminalCommand{}))
	token := tgBootstrap(t, r, n)
	request := tgUIBody("GET", "/api/v1/terminal-commands", nil)
	require.Contains(t, tgRequest(r, "ui", n.TelegramMenu.TerminalOrigin, token, request).Body.String(), `"success":true`)
	for _, path := range []string{"/api/v1/setting", "/api/v1/user", "/api/v1/terminal-sessions/keep", "https://evil.example/api/v1/terminal-commands", "//evil.example/api/v1/terminal-commands", "/api/v1/terminal-commands/../setting"} {
		require.Equal(t, 403, tgRequest(r, "ui", n.TelegramMenu.TerminalOrigin, token, tgUIBody("POST", path, nil)).Code, path)
	}
	for _, bad := range []string{"", "dashboard-jwt", "nzp_fake"} {
		require.Equal(t, 403, tgRequest(r, "ui", n.TelegramMenu.TerminalOrigin, bad, request).Code)
	}
	require.Equal(t, 403, tgRequest(r, "ui", "https://evil.example", token, request).Code)
	singleton.ServerShared.InsertForTest(&model.Server{Common: model.Common{ID: 7, UserID: 20}, UUID: "foreign"})
	for _, path := range []string{"/api/v1/terminal", "/api/v1/terminal-sessions/list", "/api/v1/terminal-sessions/tmux/window/create"} {
		w := tgRequest(r, "ui", n.TelegramMenu.TerminalOrigin, token, tgUIBody("POST", path, map[string]any{"server_id": 7}))
		require.Contains(t, w.Body.String(), `"error":`, path)
		require.NotContains(t, w.Body.String(), `"success":true`, path)
	}
	require.Contains(t, tgRequest(r, "ui", n.TelegramMenu.TerminalOrigin, token, tgUIBody("POST", "/api/v1/file?id=7", nil)).Body.String(), `"error":`)
	g, _ := tgTerminalSessions.Get(token, time.Now(), false)
	expired, e := tgTerminalSessions.Put(g, g.UserID, time.Now().Add(-time.Second), time.Now().Add(-time.Minute))
	require.NoError(t, e)
	require.Equal(t, 403, tgRequest(r, "ui", n.TelegramMenu.TerminalOrigin, expired, request).Code)
	n.TelegramMenu.Terminal = false
	require.NoError(t, singleton.DB.Model(n).Select("TelegramMenu").Updates(n).Error)
	require.Equal(t, 403, tgRequest(r, "ui", n.TelegramMenu.TerminalOrigin, token, request).Code)
}
func TestTelegramUIWindowActionsUseSharedOwnershipChecks(t *testing.T) {
	r, n := tgFixture(t)
	require.NoError(t, singleton.DB.AutoMigrate(&model.TerminalSession{}, &model.TerminalSessionEvent{}))
	token := tgBootstrap(t, r, n)
	server := &model.Server{Common: model.Common{ID: 7, UserID: 10}, UUID: "owned"}
	singleton.ServerShared.InsertForTest(server)
	raw := "NZX_OK\nS|$1|99|MTExCg==\nW|$1|@1|0|bWFpbgo=\nNZX_END"
	previous := runTmuxCommand
	defer func() { runTmuxCommand = previous }()
	mutations := 0
	runTmuxCommand = func(_ context.Context, _ *model.Server, command string) (string, error) {
		if strings.Contains(command, "new-window") {
			mutations++
			raw = "NZX_OK\nS|$1|99|MTExCg==\nW|$1|@1|0|bWFpbgo=\nW|$1|@2|1|bG9nCg==\nNZX_END"
			return "@2\n", nil
		}
		return raw, nil
	}
	w := tgRequest(r, "ui", n.TelegramMenu.TerminalOrigin, token, tgUIBody("POST", "/api/v1/terminal-sessions/list", map[string]any{"server_id": 7}))
	require.Contains(t, w.Body.String(), `"success":true`)
	var rows []model.TerminalSession
	require.NoError(t, singleton.DB.Find(&rows).Error)
	require.Len(t, rows, 1)
	w = tgRequest(r, "ui", n.TelegramMenu.TerminalOrigin, token, tgUIBody("POST", "/api/v1/terminal-sessions/tmux/window/create", map[string]any{"server_id": 7, "record_id": rows[0].ID, "name": "log"}))
	require.Contains(t, w.Body.String(), `"success":true`)
	require.Equal(t, 1, mutations)
}
func TestTelegramUISharedSocketTicketScopeReplayAndRevocation(t *testing.T) {
	r, n := tgFixture(t)
	previous := rpc.NezhaHandlerSingleton
	handler := rpc.NewNezhaHandler()
	rpc.NezhaHandlerSingleton = handler
	t.Cleanup(func() { rpc.NezhaHandlerSingleton = previous })
	require.NoError(t, singleton.DB.AutoMigrate(&model.TerminalSession{}, &model.TerminalSessionEvent{}))
	httpServer := httptest.NewServer(r)
	defer httpServer.Close()
	origin := "https://" + strings.TrimPrefix(httpServer.URL, "http://")
	n.TelegramMenu.TerminalOrigin = origin
	require.NoError(t, singleton.DB.Model(n).Select("TelegramMenu").Updates(n).Error)
	g := tgTerminalGrant{n.ID, singleton.TelegramTerminalBinding(n), 10, 0, model.RoleMember, origin}
	token, e := tgTerminalSessions.Put(g, 10, time.Now().Add(time.Minute), time.Now())
	require.NoError(t, e)
	agent := &tgEchoStream{handler: handler}
	server := &model.Server{Common: model.Common{ID: 7, UserID: 10}, UUID: "owned"}
	server.SetTaskStream(agent)
	singleton.ServerShared.InsertForTest(server)
	c := sessionRequestContext(t, map[string]any{})
	c.Set(model.CtxKeyAuthorizedUser, &model.User{Common: model.Common{ID: 10}, Role: model.RoleMember})
	c.Set(tgUIAccessKey, &tgUIAccess{token, g})
	m, e := newManagedTerminal(c, 7, "native", 0, "")
	require.NoError(t, e)
	managed := managedLookup(m.SessionID)
	defer func() { managed.close(); managed.Workers.Wait() }()
	other, e := tgTerminalSessions.Put(g, 10, time.Now().Add(time.Minute), time.Now())
	require.NoError(t, e)
	// Another TG grant and the normal dashboard cannot attach even with the stream ID.
	c.Set(tgUIAccessKey, &tgUIAccess{other, g})
	_, e = managedForRequest(c, m.SessionID)
	require.Error(t, e)
	c.Set(tgUIAccessKey, (*tgUIAccess)(nil))
	_, e = managedForRequest(c, m.SessionID)
	require.Error(t, e)
	ticket, e := tgUISockets.Put(tgUISocketTicket{Access: tgUIAccess{token, g}, Kind: "terminal", StreamID: m.SessionID, ServerID: 7, ServerUUID: "owned"}, 10, time.Now().Add(time.Minute), time.Now())
	require.NoError(t, e)
	dial := func(ticket string) *websocket.Conn {
		ws, _, e := websocket.DefaultDialer.Dial("ws://"+strings.TrimPrefix(httpServer.URL, "http://")+"/api/v1/telegram-terminal/ui-ws", http.Header{"Origin": {origin}})
		require.NoError(t, e)
		require.NoError(t, ws.WriteJSON(map[string]string{"ticket": ticket}))
		return ws
	}
	ws := dial(ticket)
	defer ws.Close()
	_ = ws.SetReadDeadline(time.Now().Add(3 * time.Second))
	_, data, e := ws.ReadMessage()
	require.NoError(t, e)
	require.JSONEq(t, `{"ready":true}`, string(data))
	require.NoError(t, ws.WriteMessage(websocket.TextMessage, []byte("hello")))
	_, data, e = ws.ReadMessage()
	require.NoError(t, e)
	require.Equal(t, append([]byte{0}, []byte("hello")...), data)
	replay := dial(ticket)
	_ = replay.SetReadDeadline(time.Now().Add(time.Second))
	_, _, e = replay.ReadMessage()
	require.Error(t, e)
	replay.Close()
	n.TelegramMenu.Terminal = false
	require.NoError(t, singleton.DB.Model(n).Select("TelegramMenu").Updates(n).Error)
	_ = ws.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, _, e = ws.ReadMessage()
	require.Error(t, e)
	require.Eventually(t, func() bool { return handler.StreamCount() == 0 }, time.Second, 10*time.Millisecond)
	// Dedicated stores must not be usable as ordinary dashboard credentials.
	_, ok := tgTerminalSessions.Get(ticket, time.Now(), false)
	require.False(t, ok)
}

func TestTelegramUIFileTicketsStayWithinGrantAndServerIdentity(t *testing.T) {
	r, n := tgFixture(t)
	token := tgBootstrap(t, r, n)
	other := tgBootstrap(t, r, n)
	g, _ := tgTerminalSessions.Get(token, time.Now(), false)
	server := &model.Server{Common: model.Common{ID: 7, UserID: 10}, UUID: "owned"}
	singleton.ServerShared.InsertForTest(server)
	key, e := tgUIFiles.Put(tgUIFile{Access: tgUIAccess{token, g}, ServerID: 7, ServerUUID: "owned", StreamID: "private-stream"}, 10, time.Now().Add(time.Minute), time.Now())
	require.NoError(t, e)
	body := map[string]string{"path": "/api/v1/ws/file/" + key}
	require.Equal(t, 403, tgRequest(r, "ui-ticket", n.TelegramMenu.TerminalOrigin, other, body).Code)
	// Same numeric ID now belonging to a different machine must not accept a ticket.
	server.UUID = "reused"
	require.Equal(t, 403, tgRequest(r, "ui-ticket", n.TelegramMenu.TerminalOrigin, token, body).Code)
	server.UUID = "owned"
	require.Equal(t, 200, tgRequest(r, "ui-ticket", n.TelegramMenu.TerminalOrigin, token, body).Code)
	require.Equal(t, 403, tgRequest(r, "ui-ticket", n.TelegramMenu.TerminalOrigin, token, body).Code)
	for _, path := range []string{"/api/v1/ws/terminal/private-stream", "https://evil.example/api/v1/ws/file/" + key, "/api/v1/file"} {
		require.Equal(t, 403, tgRequest(r, "ui-ticket", n.TelegramMenu.TerminalOrigin, token, map[string]string{"path": path}).Code)
	}
}

func TestTelegramUIFileCreateRelayAndRevoke(t *testing.T) {
	r, n := tgFixture(t)
	previous := rpc.NezhaHandlerSingleton
	handler := rpc.NewNezhaHandler()
	rpc.NezhaHandlerSingleton = handler
	t.Cleanup(func() { rpc.NezhaHandlerSingleton = previous })
	httpServer := httptest.NewServer(r)
	defer httpServer.Close()
	origin := "https://" + strings.TrimPrefix(httpServer.URL, "http://")
	n.TelegramMenu.TerminalOrigin = origin
	require.NoError(t, singleton.DB.Model(n).Select("TelegramMenu").Updates(n).Error)
	g := tgTerminalGrant{n.ID, singleton.TelegramTerminalBinding(n), 10, 0, model.RoleMember, origin}
	token, e := tgTerminalSessions.Put(g, 10, time.Now().Add(time.Minute), time.Now())
	require.NoError(t, e)
	agent := &tgEchoStream{handler: handler}
	server := &model.Server{Common: model.Common{ID: 7, UserID: 10}, UUID: "file-owned"}
	server.SetTaskStream(agent)
	singleton.ServerShared.InsertForTest(server)
	request := func(path string, body any) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest("POST", origin+"/api/v1/telegram-terminal/"+path, bytes.NewReader(raw))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", origin)
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}
	w := request("ui", tgUIBody("POST", "/api/v1/file?id=7", nil))
	var created struct {
		Success bool
		Data    model.CreateFMResponse
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &created))
	require.True(t, created.Success, w.Body.String())
	require.Len(t, created.Data.SessionID, 43)
	w = request("ui-ticket", map[string]string{"path": "/api/v1/ws/file/" + created.Data.SessionID})
	var ticket struct{ Ticket string }
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &ticket))
	require.Len(t, ticket.Ticket, 43)
	ws, _, e := websocket.DefaultDialer.Dial("ws://"+strings.TrimPrefix(httpServer.URL, "http://")+"/api/v1/telegram-terminal/ui-ws", http.Header{"Origin": {origin}})
	require.NoError(t, e)
	defer ws.Close()
	require.NoError(t, ws.WriteJSON(ticket))
	_ = ws.SetReadDeadline(time.Now().Add(3 * time.Second))
	_, data, e := ws.ReadMessage()
	require.NoError(t, e)
	require.JSONEq(t, `{"ready":true}`, string(data))
	payload := []byte{0, 1, 2, 255, 17}
	require.NoError(t, ws.WriteMessage(websocket.BinaryMessage, payload))
	_, data, e = ws.ReadMessage()
	require.NoError(t, e)
	require.Equal(t, payload, data)
	require.NoError(t, singleton.DB.Model(&model.User{}).Where("id = ?", 10).Update("token_version", 1).Error)
	_ = ws.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, _, e = ws.ReadMessage()
	require.Error(t, e)
	require.Eventually(t, func() bool { return handler.StreamCount() == 0 }, time.Second, 10*time.Millisecond)
}
