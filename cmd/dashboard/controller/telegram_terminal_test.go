package controller

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/telegramauth"
	"github.com/nezhahq/nezha/proto"
	"github.com/nezhahq/nezha/service/rpc"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"golang.org/x/time/rate"
)

func tgSignFixture(user int64, stamp time.Time) string {
	v := url.Values{"auth_date": {strconv.FormatInt(stamp.Unix(), 10)}, "user": {fmtTGUser(user)}, "query_id": {"fixture"}}
	var fields []string
	for key := range v {
		fields = append(fields, key+"="+v.Get(key))
	}
	sort.Strings(fields)
	key := hmac.New(sha256.New, []byte("WebAppData"))
	key.Write([]byte("123:fixture_token"))
	mac := hmac.New(sha256.New, key.Sum(nil))
	mac.Write([]byte(strings.Join(fields, "\n")))
	v.Set("hash", hex.EncodeToString(mac.Sum(nil)))
	return v.Encode()
}
func fmtTGUser(id int64) string {
	return `{"id":` + strconv.FormatInt(id, 10) + `,"first_name":"fixture"}`
}
func tgFixture(t *testing.T) (*gin.Engine, *model.Notification) {
	t.Helper()
	cleanup := setupTenancyTest(t)
	t.Cleanup(cleanup)
	db, _ := singleton.DB.DB()
	db.SetMaxOpenConns(1)
	require.NoError(t, singleton.DB.Create(&model.User{Common: model.Common{ID: 10}, Username: "owner", Role: model.RoleMember}).Error)
	n := telegramBotFixture(11, 10)
	n.TelegramMenu.Terminal = true
	n.TelegramMenu.TerminalOrigin = "https://terminal.example"
	require.NoError(t, singleton.DB.Create(&n).Error)
	tgTerminalSessions = telegramauth.Store[tgTerminalGrant]{}
	tgTerminalTickets = telegramauth.Store[tgTerminalTicket]{}
	tgTerminalBootstrapRate = rate.NewLimiter(1000, 1000)
	t.Cleanup(func() { tgTerminalBootstrapRate = rate.NewLimiter(5, 20) })
	r := gin.New()
	registerTelegramTerminalRoutes(r, fstest.MapFS{"admin-dist/telegram-terminal/index.html": {Data: []byte("<html>terminal shell</html>")}})
	return r, &n
}
func tgRequest(r http.Handler, path, origin, token string, body any) *httptest.ResponseRecorder {
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest("POST", "https://terminal.example/api/v1/telegram-terminal/"+path, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", origin)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}
func tgBootstrap(t *testing.T, r http.Handler, n *model.Notification) string {
	t.Helper()
	launch, err := singleton.NewTelegramTerminalLaunch(n, time.Now())
	require.NoError(t, err)
	w := tgRequest(r, "bootstrap", n.TelegramMenu.TerminalOrigin, "", map[string]string{"launch": launch, "init_data": tgSignFixture(12345678, time.Now())})
	require.Equal(t, 200, w.Code, w.Body.String())
	var result struct {
		Token string `json:"token"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
	require.Len(t, result.Token, 43)
	return result.Token
}
func TestTelegramTerminalBootstrapRejectsForeignForgedExpiredReplay(t *testing.T) {
	r, n := tgFixture(t)
	launch, err := singleton.NewTelegramTerminalLaunch(n, time.Now())
	require.NoError(t, err)
	body := map[string]string{"launch": launch, "init_data": tgSignFixture(87654321, time.Now())}
	require.Equal(t, 403, tgRequest(r, "bootstrap", n.TelegramMenu.TerminalOrigin, "", body).Code)
	body["init_data"] = strings.Replace(tgSignFixture(12345678, time.Now()), "12345678", "12345679", 1)
	require.Equal(t, 403, tgRequest(r, "bootstrap", n.TelegramMenu.TerminalOrigin, "", body).Code)
	body["init_data"] = tgSignFixture(12345678, time.Now().Add(-3*time.Minute))
	require.Equal(t, 403, tgRequest(r, "bootstrap", n.TelegramMenu.TerminalOrigin, "", body).Code)
	body["init_data"] = tgSignFixture(12345678, time.Now())
	require.Equal(t, 403, tgRequest(r, "bootstrap", "https://evil.example", "", body).Code)
	require.Equal(t, 403, tgRequest(r, "bootstrap", "", "", body).Code)
	require.Equal(t, 200, tgRequest(r, "bootstrap", n.TelegramMenu.TerminalOrigin, "", body).Code)
	require.Equal(t, 403, tgRequest(r, "bootstrap", n.TelegramMenu.TerminalOrigin, "", body).Code)
	old, err := singleton.NewTelegramTerminalLaunch(n, time.Now().Add(-6*time.Minute))
	require.NoError(t, err)
	body["launch"] = old
	require.Equal(t, 403, tgRequest(r, "bootstrap", n.TelegramMenu.TerminalOrigin, "", body).Code)
}
func TestTelegramTerminalScopesPermissionsAndRevocation(t *testing.T) {
	r, n := tgFixture(t)
	owner := &model.Server{Common: model.Common{ID: 7, UserID: 10}, UUID: "owned", Name: "HK own"}
	foreign := &model.Server{Common: model.Common{ID: 8, UserID: 20}, UUID: "foreign", Name: "private other"}
	singleton.ServerShared.InsertForTest(owner)
	singleton.ServerShared.InsertForTest(foreign)
	token := tgBootstrap(t, r, n)
	w := tgRequest(r, "servers", n.TelegramMenu.TerminalOrigin, token, nil)
	require.Equal(t, 200, w.Code)
	require.Contains(t, w.Body.String(), "HK own")
	require.NotContains(t, w.Body.String(), "private other")
	for _, bad := range []string{"", "dashboard-jwt", "nzp_fake"} {
		require.Equal(t, 403, tgRequest(r, "servers", n.TelegramMenu.TerminalOrigin, bad, nil).Code)
	}
	require.Equal(t, 403, tgRequest(r, "servers", "https://evil.example", token, nil).Code)
	require.Equal(t, 403, tgRequest(r, "connect", n.TelegramMenu.TerminalOrigin, token, map[string]any{"server_id": 8}).Code)
	require.Equal(t, 409, tgRequest(r, "connect", n.TelegramMenu.TerminalOrigin, token, map[string]any{"server_id": 7}).Code)
	// Closing the switch invalidates already-issued capabilities.
	n.TelegramMenu.Terminal = false
	require.NoError(t, singleton.DB.Model(n).Select("TelegramMenu").Updates(n).Error)
	require.Equal(t, 403, tgRequest(r, "servers", n.TelegramMenu.TerminalOrigin, token, nil).Code)
}
func TestTelegramTerminalUserChangeAndIdentityReuseRevoke(t *testing.T) {
	r, n := tgFixture(t)
	token := tgBootstrap(t, r, n)
	g, ok := tgTerminalSessions.Get(token, time.Now(), false)
	require.True(t, ok)
	singleton.ServerShared.InsertForTest(&model.Server{Common: model.Common{ID: 7, UserID: 10}, UUID: "new"})
	_, ok = tgTerminalServerAllowed(g, 7, "old")
	require.False(t, ok)
	require.NoError(t, singleton.DB.Model(&model.User{}).Where("id = ?", 10).Update("token_version", 1).Error)
	require.Equal(t, 403, tgRequest(r, "servers", n.TelegramMenu.TerminalOrigin, token, nil).Code)
}
func TestTelegramTerminalStaticShellNoListingOrTraversal(t *testing.T) {
	r, _ := tgFixture(t)
	for _, path := range []string{"/telegram-terminal/", "/telegram-terminal/index.html"} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		require.Equal(t, 200, w.Code)
		require.Contains(t, w.Body.String(), "terminal shell")
		require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
	}
	for _, path := range []string{"/telegram-terminal/../data/config.yaml", "/telegram-terminal/assets/", "/telegram-terminal/missing"} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		require.NotEqual(t, 200, w.Code)
	}
}

type tgEchoStream struct {
	failingRequestTaskStream
	handler *rpc.NezhaHandler
	count   atomic.Int32
}

func (s *tgEchoStream) Send(task *proto.Task) error {
	s.count.Add(1)
	var payload model.TerminalTask
	if err := json.Unmarshal([]byte(task.Data), &payload); err != nil {
		return err
	}
	agent, peer := net.Pipe()
	if err := s.handler.AgentConnected(payload.StreamID, agent); err != nil {
		peer.Close()
		return err
	}
	go func() { defer peer.Close(); _, _ = io.Copy(peer, peer) }()
	return nil
}
func TestTelegramTerminalWebSocketRelayOneUseAndLiveRevocation(t *testing.T) {
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
	agent := &tgEchoStream{handler: handler}
	server := &model.Server{Common: model.Common{ID: 7, UserID: 10}, UUID: "owned", Name: "fixture"}
	server.SetTaskStream(agent)
	singleton.ServerShared.InsertForTest(server)
	ticket, err := tgTerminalTickets.Put(tgTerminalTicket{g, 7, "owned"}, 10, time.Now().Add(time.Minute), time.Now())
	require.NoError(t, err)
	dial := func(token string) *websocket.Conn {
		ws, _, err := websocket.DefaultDialer.Dial("ws://"+strings.TrimPrefix(httpServer.URL, "http://")+"/api/v1/telegram-terminal/ws", http.Header{"Origin": {origin}})
		require.NoError(t, err)
		require.NoError(t, ws.WriteJSON(map[string]string{"ticket": token}))
		return ws
	}
	forged := dial(strings.Repeat("x", 43))
	_ = forged.SetReadDeadline(time.Now().Add(time.Second))
	_, _, err = forged.ReadMessage()
	require.Error(t, err)
	forged.Close()
	require.Zero(t, agent.count.Load())
	ws := dial(ticket)
	defer ws.Close()
	_ = ws.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, ready, err := ws.ReadMessage()
	require.NoError(t, err)
	require.JSONEq(t, `{"ready":true}`, string(ready))
	require.NoError(t, ws.WriteMessage(websocket.TextMessage, []byte("hello")))
	_, data, err := ws.ReadMessage()
	require.NoError(t, err)
	require.Equal(t, append([]byte{0}, []byte("hello")...), data)
	replay := dial(ticket)
	_ = replay.SetReadDeadline(time.Now().Add(time.Second))
	_, _, err = replay.ReadMessage()
	require.Error(t, err)
	replay.Close()
	require.EqualValues(t, 1, agent.count.Load())
	n.TelegramMenu.Terminal = false
	require.NoError(t, singleton.DB.Model(n).Select("TelegramMenu").Updates(n).Error)
	_ = ws.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, _, err = ws.ReadMessage()
	require.Error(t, err)
	require.Eventually(t, func() bool { return handler.StreamCount() == 0 }, time.Second, 10*time.Millisecond)
}
