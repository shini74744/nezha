package controller

import (
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/hashicorp/go-uuid"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/telegramauth"
	"github.com/nezhahq/nezha/pkg/websocketx"
	"github.com/nezhahq/nezha/proto"
	"github.com/nezhahq/nezha/service/rpc"
	"github.com/nezhahq/nezha/service/singleton"
	"golang.org/x/time/rate"
)

type tgTerminalGrant struct {
	NotificationID       uint64
	Binding              string
	UserID, TokenVersion uint64
	Role                 model.Role
	Origin               string
}
type tgTerminalTicket struct {
	Grant      tgTerminalGrant
	ServerID   uint64
	ServerUUID string
}

var tgTerminalSessions telegramauth.Store[tgTerminalGrant]
var tgTerminalTickets telegramauth.Store[tgTerminalTicket]
var tgTerminalBootstrapRate = rate.NewLimiter(5, 20)
var tgTerminalHandshakes = make(chan struct{}, 32)

func registerTelegramTerminalRoutes(r *gin.Engine, dist fs.FS) {
	// A separate public shell with no server data; APIs below require dedicated
	// Telegram capabilities and never accept panel cookies, JWTs or PATs.
	sub, err := fs.Sub(dist, "admin-dist/telegram-terminal")
	if err == nil {
		r.GET("/telegram-terminal/*path", func(c *gin.Context) {
			tgTerminalHeaders(c)
			c.Header("Content-Security-Policy", "default-src 'none'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors https://web.telegram.org https://*.telegram.org")
			path := strings.TrimPrefix(c.Param("path"), "/")
			if path == "" {
				path = "index.html"
			}
			if !fs.ValidPath(path) || (path != "index.html" && !strings.HasPrefix(path, "assets/")) {
				c.Status(404)
				return
			}
			info, err := fs.Stat(sub, path)
			if err != nil || info.IsDir() {
				c.Status(http.StatusNotFound)
				return
			}
			http.FileServer(http.FS(sub)).ServeHTTP(c.Writer, cloneTelegramStaticRequest(c.Request, path))
		})
	}
	api := r.Group("/api/v1/telegram-terminal")
	api.Use(func(c *gin.Context) { tgTerminalHeaders(c); c.Next() })
	api.POST("/bootstrap", tgTerminalBootstrap)
	api.POST("/servers", tgTerminalServers)
	api.POST("/connect", tgTerminalConnect)
	api.GET("/ws", tgTerminalWebSocket)
}
func cloneTelegramStaticRequest(r *http.Request, path string) *http.Request {
	copy := r.Clone(r.Context())
	u := *r.URL
	u.Path, u.RawPath = "/"+path, ""
	if path == "index.html" {
		u.Path = "/"
	}
	copy.URL = &u
	return copy
}
func tgTerminalHeaders(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("X-Content-Type-Options", "nosniff")
}
func tgTerminalDeny(c *gin.Context) {
	c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "授权无效或已过期，请从 TG 网页终端菜单重新打开。"})
}
func tgTerminalOrigin(c *gin.Context, expected string) bool {
	u, err := url.Parse(expected)
	return err == nil && u.Scheme == "https" && u.Host == c.Request.Host &&
		c.GetHeader("Origin") == expected && c.GetHeader("Sec-Fetch-Site") != "cross-site"
}
func tgTerminalCurrent(g tgTerminalGrant) (*model.User, bool) {
	if singleton.DB == nil || singleton.ServerIDReassignmentInProgress.Load() {
		return nil, false
	}
	var n model.Notification
	if singleton.DB.First(&n, g.NotificationID).Error != nil || n.TelegramMenu == nil ||
		!n.TelegramMenu.Enabled || !n.TelegramMenu.Terminal || n.ValidateTelegramMenu() != nil ||
		singleton.TelegramTerminalBinding(&n) != g.Binding || n.UserID != g.UserID {
		return nil, false
	}
	var user model.User
	if singleton.DB.Select("id", "role", "token_version").First(&user, g.UserID).Error != nil ||
		(user.Role != model.RoleAdmin && user.Role != model.RoleMember) ||
		user.TokenVersion != g.TokenVersion || user.Role != g.Role {
		return nil, false
	}
	return &user, true
}
func tgTerminalBootstrap(c *gin.Context) {
	if !tgTerminalBootstrapRate.Allow() {
		c.Status(http.StatusTooManyRequests)
		return
	}
	var request struct {
		Launch   string `json:"launch"`
		InitData string `json:"init_data"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16384)
	if c.ShouldBindJSON(&request) != nil {
		tgTerminalDeny(c)
		return
	}
	now := time.Now()
	launch, ok := singleton.GetTelegramTerminalLaunch(request.Launch, now, false)
	if !ok || singleton.DB == nil {
		tgTerminalDeny(c)
		return
	}
	var n model.Notification
	if singleton.DB.First(&n, launch.NotificationID).Error != nil || n.TelegramMenu == nil ||
		!n.TelegramMenu.Enabled || !n.TelegramMenu.Terminal || n.ValidateTelegramMenu() != nil ||
		singleton.TelegramTerminalBinding(&n) != launch.Binding ||
		!tgTerminalOrigin(c, n.TelegramMenu.TerminalOrigin) {
		tgTerminalDeny(c)
		return
	}
	target, err := n.TelegramMenuTarget()
	if err != nil || telegramauth.Verify(request.InitData, target.Token, target.ChatID, now) != nil {
		tgTerminalDeny(c)
		return
	}
	var user model.User
	if singleton.DB.Select("id", "role", "token_version").First(&user, n.UserID).Error != nil ||
		(user.Role != model.RoleAdmin && user.Role != model.RoleMember) {
		tgTerminalDeny(c)
		return
	}
	// Invalid/foreign identities cannot burn the owner's link. Atomic consumption
	// happens only after all checks; parallel/replayed valid attempts lose here.
	if _, ok := singleton.GetTelegramTerminalLaunch(request.Launch, now, true); !ok {
		tgTerminalDeny(c)
		return
	}
	grant := tgTerminalGrant{n.ID, launch.Binding, user.ID, user.TokenVersion, user.Role, n.TelegramMenu.TerminalOrigin}
	token, err := tgTerminalSessions.Put(grant, user.ID, now.Add(15*time.Minute), now)
	if err != nil {
		tgTerminalDeny(c)
		return
	}
	c.JSON(200, gin.H{"token": token, "expires_in": 900})
}
func tgTerminalSession(c *gin.Context) (tgTerminalGrant, *model.User, bool) {
	header := c.GetHeader("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		return tgTerminalGrant{}, nil, false
	}
	g, ok := tgTerminalSessions.Get(strings.TrimPrefix(header, "Bearer "), time.Now(), false)
	if !ok || !tgTerminalOrigin(c, g.Origin) {
		return g, nil, false
	}
	user, ok := tgTerminalCurrent(g)
	return g, user, ok
}

type tgTerminalServer struct {
	ID     uint64 `json:"id"`
	Name   string `json:"name"`
	Online bool   `json:"online"`
}

func tgTerminalServers(c *gin.Context) {
	_, user, ok := tgTerminalSession(c)
	if !ok || singleton.ServerShared == nil {
		tgTerminalDeny(c)
		return
	}
	c.Set(model.CtxKeyAuthorizedUser, user)
	rows := make([]tgTerminalServer, 0)
	for _, server := range singleton.ServerShared.GetSortedList() {
		if !server.HasPermission(c) {
			continue
		}
		last := server.RuntimeSnapshot().LastActive
		rows = append(rows, tgTerminalServer{server.ID, server.Name, server.GetTaskStream() != nil && !last.IsZero() && time.Since(last) <= 30*time.Second})
	}
	c.JSON(200, gin.H{"servers": rows})
}
func tgTerminalServerAllowed(g tgTerminalGrant, id uint64, identity string) (*model.Server, bool) {
	user, ok := tgTerminalCurrent(g)
	if !ok || singleton.ServerShared == nil {
		return nil, false
	}
	server, ok := singleton.ServerShared.Get(id)
	if !ok || server == nil || (identity != "" && server.UUID != identity) ||
		(user.Role != model.RoleAdmin && server.GetUserID() != user.ID) {
		return nil, false
	}
	return server, true
}
func tgTerminalConnect(c *gin.Context) {
	g, _, ok := tgTerminalSession(c)
	if !ok {
		tgTerminalDeny(c)
		return
	}
	var request struct {
		ID uint64 `json:"server_id"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
	if c.ShouldBindJSON(&request) != nil || request.ID == 0 {
		tgTerminalDeny(c)
		return
	}
	server, ok := tgTerminalServerAllowed(g, request.ID, "")
	if !ok {
		tgTerminalDeny(c)
		return
	}
	if server.GetTaskStream() == nil {
		c.JSON(409, gin.H{"error": "服务器离线，暂时无法连接。"})
		return
	}
	now := time.Now()
	ticket, err := tgTerminalTickets.Put(tgTerminalTicket{g, server.ID, server.UUID}, g.UserID, now.Add(30*time.Second), now)
	if err != nil {
		c.JSON(429, gin.H{"error": "连接次数较多，请稍后重试。"})
		return
	}
	c.JSON(200, gin.H{"ticket": ticket})
}

type tgTerminalIO struct{ *websocketx.Conn }

func (conn *tgTerminalIO) Read(p []byte) (int, error) {
	n, err := conn.Conn.Read(p)
	if n > 0 {
		_ = conn.SetReadDeadline(time.Now().Add(5 * time.Minute))
	}
	return n, err
}
func tgTerminalWebSocket(c *gin.Context) {
	// Reject cross-site sockets before upgrade, then authenticate the first frame.
	// Neither one-use tickets nor session credentials appear in URLs/access logs.
	origin := c.GetHeader("Origin")
	u, err := url.Parse(origin)
	if err != nil || u.Scheme != "https" || u.Host != c.Request.Host || u.Path != "" || u.RawQuery != "" || u.User != nil {
		tgTerminalDeny(c)
		return
	}
	select {
	case tgTerminalHandshakes <- struct{}{}:
	default:
		c.Status(429)
		return
	}
	slotHeld := true
	defer func() {
		if slotHeld {
			<-tgTerminalHandshakes
		}
	}()
	upgrade := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return r.Header.Get("Origin") == origin }}
	ws, err := upgrade.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer ws.Close()
	ws.SetReadLimit(256)
	_ = ws.SetReadDeadline(time.Now().Add(3 * time.Second))
	var request struct {
		Ticket string `json:"ticket"`
	}
	if ws.ReadJSON(&request) != nil {
		return
	}
	ticket, ok := tgTerminalTickets.Get(request.Ticket, time.Now(), false)
	if !ok || !tgTerminalOrigin(c, ticket.Grant.Origin) {
		return
	}
	server, ok := tgTerminalServerAllowed(ticket.Grant, ticket.ServerID, ticket.ServerUUID)
	if !ok || server.GetTaskStream() == nil {
		return
	}
	if _, ok = tgTerminalTickets.Get(request.Ticket, time.Now(), true); !ok {
		return
	}
	<-tgTerminalHandshakes
	slotHeld = false
	handler := rpc.NezhaHandlerSingleton
	if handler == nil {
		return
	}
	streamID, err := uuid.GenerateUUID()
	if err != nil || handler.CreateStreamWithPurpose(streamID, ticket.Grant.UserID, server.ID, rpc.PurposeTerminal) != nil {
		return
	}
	defer handler.CloseStream(streamID)
	payload, _ := json.Marshal(model.TerminalTask{StreamID: streamID})
	if server.SendTask(&proto.Task{Type: model.TaskTypeTerminalGRPC, Data: string(payload)}) != nil {
		return
	}
	conn := &tgTerminalIO{websocketx.NewConn(ws)}
	ws.SetReadLimit(terminalWebSocketInputLimit)
	_ = ws.SetReadDeadline(time.Now().Add(5 * time.Minute))
	if conn.WriteMessage(websocket.TextMessage, []byte(`{"ready":true}`)) != nil {
		return
	}
	if handler.UserConnected(streamID, conn) != nil {
		return
	}
	log.Printf("NEZHA>> TGTerminal::open notification=%d user=%d server=%d", ticket.Grant.NotificationID, ticket.Grant.UserID, server.ID)
	defer log.Printf("NEZHA>> TGTerminal::close notification=%d user=%d server=%d", ticket.Grant.NotificationID, ticket.Grant.UserID, server.ID)
	done := make(chan struct{})
	defer close(done)
	// Revocation and absolute expiry also close idle/output-only connections.
	go func() {
		ticker := time.NewTicker(3 * time.Second)
		defer ticker.Stop()
		deadline := time.NewTimer(30 * time.Minute)
		defer deadline.Stop()
		for {
			select {
			case <-done:
				return
			case <-deadline.C:
				_ = ws.Close()
				_ = handler.CloseStream(streamID)
				return
			case <-ticker.C:
				if _, ok := tgTerminalServerAllowed(ticket.Grant, ticket.ServerID, ticket.ServerUUID); !ok {
					_ = ws.Close()
					_ = handler.CloseStream(streamID)
					return
				}
			}
		}
	}()
	ping := newWebsocketPingTransport(conn, ws.Close)
	stop := startWebsocketPingTicker(c.Request.Context(), 10*time.Second, ping)
	defer stop()
	_ = handler.StartStream(streamID, 10*time.Second)
}
