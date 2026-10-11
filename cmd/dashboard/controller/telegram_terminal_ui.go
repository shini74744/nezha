package controller

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/telegramauth"
	"github.com/nezhahq/nezha/service/rpc"
)

const tgUIAccessKey = "telegram-terminal-ui-access"
const tgUISocketKey = "telegram-terminal-ui-socket"

// This capability never becomes a dashboard login. It stays in memory and is
// revalidated on each request and while a terminal/file stream remains open.
type tgUIAccess struct {
	Token string
	Grant tgTerminalGrant
}

func (a *tgUIAccess) valid() bool {
	if a == nil {
		return false
	}
	g, ok := tgTerminalSessions.Get(a.Token, time.Now(), false)
	if !ok || g != a.Grant {
		return false
	}
	_, ok = tgTerminalCurrent(g)
	return ok
}
func tgUIAccessFor(c *gin.Context) *tgUIAccess {
	value, _ := c.Get(tgUIAccessKey)
	a, _ := value.(*tgUIAccess)
	return a
}
func tgUIAuthorize(c *gin.Context) (*tgUIAccess, bool) {
	g, user, ok := tgTerminalSession(c)
	if !ok {
		tgTerminalDeny(c)
		return nil, false
	}
	a := &tgUIAccess{Token: strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer "), Grant: g}
	c.Set(tgUIAccessKey, a)
	c.Set(model.CtxKeyAuthorizedUser, user)
	return a, true
}

type tgUIFile struct {
	Started              *atomic.Bool
	Access               tgUIAccess
	ServerID             uint64
	ServerUUID, StreamID string
}
type tgUISocketTicket struct {
	FileStarted    *atomic.Bool
	Access         tgUIAccess
	Kind, StreamID string
	ServerID       uint64
	ServerUUID     string
}

var tgUIFiles telegramauth.Store[tgUIFile]
var tgUISockets telegramauth.Store[tgUISocketTicket]

// All UI calls are same-origin POSTs, including reads, so Origin is mandatory.
// Only these exact operations are exposed; there is no proxy to arbitrary APIs.
func tgTerminalUI(c *gin.Context) {
	a, ok := tgUIAuthorize(c)
	if !ok {
		return
	}
	var form struct {
		Method, Path string
		Data         json.RawMessage
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 96*1024)
	if c.ShouldBindJSON(&form) != nil {
		tgTerminalDeny(c)
		return
	}
	u, err := url.Parse(form.Path)
	if err != nil || u.IsAbs() || u.Host != "" || u.Fragment != "" || u.RawPath != "" {
		tgTerminalDeny(c)
		return
	}
	var handler gin.HandlerFunc
	switch form.Method + " " + u.Path {
	case "POST /api/v1/terminal":
		handler = commonHandler(func(c *gin.Context) (*managedTerminalView, error) {
			var f struct {
				ServerID uint64 `json:"server_id"`
			}
			if e := bindTerminalSession(c, &f); e != nil {
				return nil, e
			}
			return newManagedTerminal(c, f.ServerID, "native", 0, "")
		})
	case "POST /api/v1/terminal-sessions/list":
		handler = commonHandler(func(c *gin.Context) (*terminalSessionList, error) {
			rows, e := listTerminalSessions(c)
			if rows != nil {
				rows.Native = []terminalSessionItem{}
			}
			return rows, e
		})
	case "POST /api/v1/terminal-sessions/tmux/create":
		handler = commonHandler(createTmuxSession)
	case "POST /api/v1/terminal-sessions/tmux/attach":
		handler = commonHandler(attachTmuxSession)
	case "POST /api/v1/terminal-sessions/tmux/end":
		handler = commonHandler(endTmuxSession)
	case "POST /api/v1/terminal-sessions/tmux/window/create":
		handler = commonHandler(createTmuxWindow)
	case "POST /api/v1/terminal-sessions/tmux/window/end":
		handler = commonHandler(endTmuxWindow)
	case "POST /api/v1/terminal-sessions/tmux/install":
		handler = commonHandler(installTmux)
	case "POST /api/v1/terminal-sessions/tmux/install-status":
		handler = commonHandler(tmuxInstallStatus)
	case "GET /api/v1/terminal-commands":
		handler = commonHandler(listTerminalCommands)
	case "POST /api/v1/terminal-commands":
		handler = commonHandler(createTerminalCommand)
	case "POST /api/v1/file":
		handler = commonHandler(func(c *gin.Context) (*model.CreateFMResponse, error) {
			id, e := strconv.ParseUint(c.Query("id"), 10, 64)
			if e != nil {
				return nil, errors.New("服务器无效")
			}
			s, allowed := tgTerminalServerAllowed(a.Grant, id, "")
			if !allowed {
				return nil, errors.New("无权访问此服务器")
			}
			result, e := createFM(c)
			if e != nil {
				return nil, e
			}
			started := &atomic.Bool{}
			h := rpc.NezhaHandlerSingleton
			key, e := tgUIFiles.Put(tgUIFile{started, *a, id, s.UUID, result.SessionID}, a.Grant.UserID, time.Now().Add(30*time.Second), time.Now())
			if e != nil {
				_ = rpc.NezhaHandlerSingleton.CloseStream(result.SessionID)
				return nil, e
			}
			// Reclaim abandoned pre-attach streams without interrupting an attached transfer.
			time.AfterFunc(65*time.Second, func() {
				if started.CompareAndSwap(false, true) {
					_ = h.CloseStream(result.SessionID)
				}
			})
			// The browser receives a short opaque reference, not a dashboard stream ID.
			return &model.CreateFMResponse{SessionID: key}, nil
		})
	default:
		prefix := "/api/v1/terminal-commands/"
		if strings.HasPrefix(u.Path, prefix) {
			id := strings.TrimPrefix(u.Path, prefix)
			if n, e := strconv.ParseUint(id, 10, 64); e == nil && n > 0 {
				c.Params = gin.Params{{Key: "id", Value: id}}
				if form.Method == "PUT" {
					handler = commonHandler(updateTerminalCommand)
				}
				if form.Method == "DELETE" {
					handler = commonHandler(deleteTerminalCommand)
				}
			}
		}
	}
	if handler == nil || (u.RawQuery != "" && u.Path != "/api/v1/file") {
		tgTerminalDeny(c)
		return
	}
	c.Request.Method = form.Method
	c.Request.URL = u
	c.Request.Header.Set("Content-Type", "application/json")
	c.Request.Body = io.NopCloser(bytes.NewReader(form.Data))
	handler(c)
}
func tgTerminalUITicket(c *gin.Context) {
	a, ok := tgUIAuthorize(c)
	if !ok {
		return
	}
	var form struct {
		Path string `json:"path"`
	}
	if bindTerminalSession(c, &form) != nil {
		tgTerminalDeny(c)
		return
	}
	u, e := url.Parse(form.Path)
	if e != nil || u.IsAbs() || u.Host != "" || u.Fragment != "" || u.RawPath != "" {
		tgTerminalDeny(c)
		return
	}
	ticket := tgUISocketTicket{Access: *a}
	switch {
	case strings.HasPrefix(u.Path, "/api/v1/ws/terminal/"):
		id := strings.TrimPrefix(u.Path, "/api/v1/ws/terminal/")
		m, e := managedForRequest(c, id)
		if e != nil || m.TGAccess == nil || m.TGAccess.Token != a.Token {
			tgTerminalDeny(c)
			return
		}
		ticket.Kind = "terminal"
		ticket.StreamID = id
		ticket.ServerID = m.ServerID
		ticket.ServerUUID = m.ServerUUID
	case strings.HasPrefix(u.Path, "/api/v1/ws/file/"):
		key := strings.TrimPrefix(u.Path, "/api/v1/ws/file/")
		f, ok := tgUIFiles.Get(key, time.Now(), false)
		if !ok || f.Access.Token != a.Token {
			tgTerminalDeny(c)
			return
		}
		ticket.Kind = "file"
		ticket.FileStarted = f.Started
		ticket.StreamID = f.StreamID
		ticket.ServerID = f.ServerID
		ticket.ServerUUID = f.ServerUUID
		// Consume only after ownership and identity checks.
		if _, ok := tgTerminalServerAllowed(a.Grant, f.ServerID, f.ServerUUID); !ok {
			tgTerminalDeny(c)
			return
		}
		if _, ok := tgUIFiles.Get(key, time.Now(), true); !ok {
			tgTerminalDeny(c)
			return
		}
	default:
		tgTerminalDeny(c)
		return
	}
	if _, ok := tgTerminalServerAllowed(a.Grant, ticket.ServerID, ticket.ServerUUID); !ok {
		tgTerminalDeny(c)
		return
	}
	key, e := tgUISockets.Put(ticket, a.Grant.UserID, time.Now().Add(30*time.Second), time.Now())
	if e != nil {
		tgTerminalDeny(c)
		return
	}
	c.JSON(200, gin.H{"ticket": key})
}
func upgradeTerminalSocket(c *gin.Context) (*websocket.Conn, error) {
	if value, ok := c.Get(tgUISocketKey); ok {
		ws := value.(*websocket.Conn)
		return ws, ws.WriteMessage(websocket.TextMessage, []byte(`{"ready":true}`))
	}
	return upgrader.Upgrade(c.Writer, c.Request, nil)
}
func tgTerminalUISocket(c *gin.Context) {
	if !terminalSessionOrigin(c.Request) || !strings.HasPrefix(c.GetHeader("Origin"), "https://") {
		tgTerminalDeny(c)
		return
	}
	select {
	case tgTerminalHandshakes <- struct{}{}:
	default:
		c.Status(429)
		return
	}
	held := true
	defer func() {
		if held {
			<-tgTerminalHandshakes
		}
	}()
	upgrade := websocket.Upgrader{CheckOrigin: terminalSessionOrigin}
	ws, e := upgrade.Upgrade(c.Writer, c.Request, nil)
	if e != nil {
		return
	}
	defer ws.Close()
	ws.SetReadLimit(256)
	_ = ws.SetReadDeadline(time.Now().Add(3 * time.Second))
	var form struct {
		Ticket string `json:"ticket"`
	}
	if ws.ReadJSON(&form) != nil {
		return
	}
	ticket, ok := tgUISockets.Get(form.Ticket, time.Now(), false)
	if !ok || !ticket.Access.valid() || !tgTerminalOrigin(c, ticket.Access.Grant.Origin) {
		return
	}
	if _, ok = tgTerminalServerAllowed(ticket.Access.Grant, ticket.ServerID, ticket.ServerUUID); !ok {
		return
	}
	if _, ok = tgUISockets.Get(form.Ticket, time.Now(), true); !ok {
		return
	}
	<-tgTerminalHandshakes
	held = false
	if ticket.Kind == "file" {
		if ticket.FileStarted == nil || !ticket.FileStarted.CompareAndSwap(false, true) {
			return
		}
		defer rpc.NezhaHandlerSingleton.CloseStream(ticket.StreamID)
	}
	user, ok := tgTerminalCurrent(ticket.Access.Grant)
	if !ok {
		return
	}
	c.Set(tgUIAccessKey, &ticket.Access)
	c.Set(tgUISocketKey, ws)
	c.Set(model.CtxKeyAuthorizedUser, user)
	c.Params = gin.Params{{Key: "id", Value: ticket.StreamID}}
	log.Printf("NEZHA>> TGTerminalUI::open notification=%d user=%d server=%d kind=%s", ticket.Access.Grant.NotificationID, user.ID, ticket.ServerID, ticket.Kind)
	defer log.Printf("NEZHA>> TGTerminalUI::close notification=%d user=%d server=%d kind=%s", ticket.Access.Grant.NotificationID, user.ID, ticket.ServerID, ticket.Kind)
	ws.SetReadLimit(16 * 1024 * 1024)
	_ = ws.SetReadDeadline(time.Time{})
	done := make(chan struct{})
	defer close(done)
	go func() {
		timer := time.NewTicker(time.Second)
		defer timer.Stop()
		for {
			select {
			case <-done:
				return
			case <-timer.C:
				if !ticket.Access.valid() {
					_ = ws.Close()
					return
				}
				if _, ok := tgTerminalServerAllowed(ticket.Access.Grant, ticket.ServerID, ticket.ServerUUID); !ok {
					_ = ws.Close()
					return
				}
			}
		}
	}()
	if ticket.Kind == "terminal" {
		m, e := managedForRequest(c, ticket.StreamID)
		if e == nil {
			_, _ = managedTerminalStream(c, m)
		}
	} else {
		_, _ = fmStream(c)
	}
}

func sameTerminalAccess(a, b *tgUIAccess) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return a.Token == b.Token
}
