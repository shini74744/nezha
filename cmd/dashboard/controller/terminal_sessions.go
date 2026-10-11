package controller

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/hashicorp/go-uuid"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/terminalsession"
	"github.com/nezhahq/nezha/pkg/websocketx"
	"github.com/nezhahq/nezha/proto"
	"github.com/nezhahq/nezha/service/rpc"
	"github.com/nezhahq/nezha/service/singleton"
	"gorm.io/gorm"
)

type managedTerminal struct {
	TGAccess                                    *tgUIAccess
	mu                                          sync.Mutex
	ID                                          string
	UserID, ServerID, ServerOwner, TokenVersion uint64
	ServerUUID                                  string
	Role                                        model.Role
	Name, Kind                                  string
	RowID                                       uint64
	Keep                                        bool
	Created                                     time.Time
	Bridge                                      *terminalsession.Bridge
	Handler                                     *rpc.NezhaHandler
	CloseOnce                                   sync.Once
	Workers                                     sync.WaitGroup
}

var managedTerminals = struct {
	sync.Mutex
	rows map[string]*managedTerminal
}{rows: make(map[string]*managedTerminal)}

type managedTerminalView = model.CreateTerminalResponse

func terminalBrowserUser(c *gin.Context) (*model.User, error) {
	c.Header("Cache-Control", "no-store")
	if _, pat := c.Get(model.CtxKeyAPIToken); pat {
		return nil, errors.New("请使用后台登录会话")
	}
	raw, ok := c.Get(model.CtxKeyAuthorizedUser)
	u, valid := raw.(*model.User)
	if !ok || !valid || u == nil || u.ID == 0 || (u.Role != model.RoleAdmin && u.Role != model.RoleMember) {
		return nil, errors.New("请先登录")
	}
	return u, nil
}
func terminalAuthorizedServer(c *gin.Context, id uint64) (*model.User, *model.Server, error) {
	u, e := terminalBrowserUser(c)
	if e != nil {
		return nil, nil, e
	}
	if singleton.ServerIDReassignmentInProgress.Load() {
		return nil, nil, errors.New("服务器正在调整，请稍后重试")
	}
	s, ok := singleton.ServerShared.Get(id)
	if !ok || s == nil || !s.HasPermission(c) {
		return nil, nil, errors.New("服务器不存在或无权访问")
	}
	return u, s, nil
}
func managedLookup(id string) *managedTerminal {
	managedTerminals.Lock()
	defer managedTerminals.Unlock()
	return managedTerminals.rows[id]
}
func (m *managedTerminal) valid() bool {
	if m.TGAccess != nil && !m.TGAccess.valid() {
		return false
	}
	if singleton.DB == nil || singleton.ServerShared == nil || singleton.ServerIDReassignmentInProgress.Load() {
		return false
	}
	s, ok := singleton.ServerShared.Get(m.ServerID)
	if !ok || s.UUID != m.ServerUUID || s.GetUserID() != m.ServerOwner {
		return false
	}
	var u model.User
	if singleton.DB.Select("id", "role", "token_version").First(&u, m.UserID).Error != nil {
		return false
	}
	return u.Role == m.Role && u.TokenVersion == m.TokenVersion && (u.Role == model.RoleAdmin || s.GetUserID() == u.ID)
}
func (m *managedTerminal) view() *managedTerminalView {
	m.mu.Lock()
	defer m.mu.Unlock()
	return &managedTerminalView{SessionID: m.ID, ServerID: m.ServerID, ServerName: m.Name, Kind: m.Kind, Keep: m.Keep, RecordID: m.RowID}
}
func (m *managedTerminal) close() {
	m.CloseOnce.Do(func() {
		_ = m.Bridge.Close()
		_ = m.Handler.CloseStream(m.ID)
		managedTerminals.Lock()
		if managedTerminals.rows[m.ID] == m {
			delete(managedTerminals.rows, m.ID)
		}
		managedTerminals.Unlock()
		m.mu.Lock()
		rowID, kind := m.RowID, m.Kind
		m.mu.Unlock()
		if rowID != 0 && kind == "native" && singleton.DB != nil {
			_ = singleton.DB.Model(&model.TerminalSession{}).Where("id = ? AND user_id = ?", rowID, m.UserID).Update("status", "closed").Error
		}
	})
}
func newManagedTerminal(c *gin.Context, serverID uint64, kind string, rowID uint64, initial string) (*managedTerminalView, error) {
	u, s, err := terminalAuthorizedServer(c, serverID)
	if err != nil {
		return nil, err
	}
	if s.GetTaskStream() == nil {
		return nil, errors.New("服务器离线，暂时无法连接")
	}
	id, err := uuid.GenerateUUID()
	if err != nil {
		return nil, err
	}
	handler := rpc.NezhaHandlerSingleton
	if err = handler.CreateStreamWithPurpose(id, u.ID, s.ID, rpc.PurposeTerminal); err != nil {
		return nil, err
	}
	m := &managedTerminal{TGAccess: tgUIAccessFor(c), ID: id, UserID: u.ID, ServerID: s.ID, ServerOwner: s.GetUserID(), ServerUUID: s.UUID, TokenVersion: u.TokenVersion, Role: u.Role, Name: s.Name, Kind: kind, RowID: rowID, Created: time.Now(), Bridge: terminalsession.New(), Handler: handler}
	if err = handler.UserConnected(id, m.Bridge); err != nil {
		m.close()
		return nil, err
	}
	if initial != "" {
		if err = m.Bridge.Send(nil, append([]byte{0}, []byte(initial+"\r")...)); err != nil {
			m.close()
			return nil, err
		}
	}
	data, _ := json.Marshal(model.TerminalTask{StreamID: id})
	if err = s.SendTask(&proto.Task{Type: model.TaskTypeTerminalGRPC, Data: string(data)}); err != nil {
		m.close()
		return nil, err
	}
	managedTerminals.Lock()
	managedTerminals.rows[id] = m
	managedTerminals.Unlock()
	m.Workers.Add(2)
	go func() { defer m.Workers.Done(); defer m.close(); _ = handler.StartStream(id, 15*time.Second) }()
	go func() {
		defer m.Workers.Done()
		timer := time.NewTicker(3 * time.Second)
		defer timer.Stop()
		for {
			select {
			case <-m.Bridge.Done():
				return
			case <-timer.C:
				if !m.valid() {
					m.close()
					return
				}
				m.mu.Lock()
				keep := m.Keep
				m.mu.Unlock()
				if !keep && !m.Bridge.Attached() && time.Since(m.Created) > 45*time.Second {
					m.close()
					return
				}
			}
		}
	}()
	return m.view(), nil
}
func managedForRequest(c *gin.Context, id string) (*managedTerminal, error) {
	u, e := terminalBrowserUser(c)
	if e != nil {
		return nil, e
	}
	m := managedLookup(id)
	if m == nil || m.UserID != u.ID || !m.valid() || !sameTerminalAccess(m.TGAccess, tgUIAccessFor(c)) {
		return nil, errors.New("会话已结束或无权访问")
	}
	return m, nil
}
func managedTerminalStream(c *gin.Context, m *managedTerminal) (any, error) {
	// Reject cross-site requests before reserving or affecting a terminal.
	if !terminalSessionOrigin(c.Request) {
		return nil, errors.New("终端仅允许同源访问")
	}
	a, err := m.Bridge.Attach()
	if err != nil {
		return nil, err
	}
	upgraded := false
	defer func() {
		m.Bridge.Detach(a)
		m.mu.Lock()
		keep := m.Keep
		m.mu.Unlock()
		if upgraded && !keep && !m.Bridge.Attached() {
			m.close()
		}
	}()
	ws, err := upgradeTerminalSocket(c)
	if err != nil {
		return nil, err
	}
	upgraded = true
	defer ws.Close()
	ws.SetReadLimit(terminalWebSocketInputLimit)
	_ = ws.SetReadDeadline(time.Now().Add(45 * time.Second))
	ws.SetPongHandler(func(string) error { return ws.SetReadDeadline(time.Now().Add(45 * time.Second)) })
	inputDone := make(chan struct{})
	go func() {
		defer close(inputDone)
		conn := websocketx.NewConn(ws)
		buffer := make([]byte, terminalWebSocketInputLimit+1)
		for {
			n, e := conn.Read(buffer)
			if e != nil {
				return
			}
			if n > 0 {
				if e = m.Bridge.Send(a, buffer[:n]); e != nil {
					return
				}
			}
		}
	}()
	ping := time.NewTicker(10 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-inputDone:
			return nil, nil
		case <-a.Done:
			return nil, nil
		case <-m.Bridge.Done():
			return nil, nil
		case output := <-a.Output:
			_ = ws.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if err = ws.WriteMessage(websocket.BinaryMessage, output); err != nil {
				return nil, nil
			}
		case <-ping.C:
			if !m.valid() {
				m.close()
				return nil, nil
			}
			if err = ws.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)); err != nil {
				return nil, nil
			}
		}
	}
}
func bindTerminalSession(c *gin.Context, out any) error {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8192)
	if c.ShouldBindJSON(out) != nil {
		return errors.New("会话参数无效")
	}
	return nil
}
func terminalEvent(tx *gorm.DB, row *model.TerminalSession, action string) error {
	return tx.Create(&model.TerminalSessionEvent{Common: model.Common{UserID: row.UserID}, SessionID: row.ID, ServerUUID: row.ServerUUID, Action: action, Name: row.Name, WindowName: row.CreatedWindowName}).Error
}
func keepTerminalSession(c *gin.Context) (*managedTerminalView, error) {
	var form struct {
		StreamID string `json:"stream_id"`
		Enabled  bool   `json:"enabled"`
	}
	if e := bindTerminalSession(c, &form); e != nil {
		return nil, e
	}
	m, e := managedForRequest(c, form.StreamID)
	if e != nil {
		return nil, e
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.Kind != "native" {
		return nil, errors.New("tmux 会话已独立保持，无需开启原生保持")
	}
	select {
	case <-m.Bridge.Done():
		return nil, terminalsession.ErrClosed
	default:
	}
	if m.Keep != form.Enabled {
		var savedID uint64
		e = singleton.DB.Transaction(func(tx *gorm.DB) error {
			row := model.TerminalSession{Common: model.Common{UserID: m.UserID}, ServerID: m.ServerID, ServerUUID: m.ServerUUID, Kind: "native", StreamID: m.ID, Name: fmt.Sprintf("终端 %s", m.Created.Format("01-02 15:04:05")), Status: "held", Source: "panel"}
			if m.RowID == 0 {
				if e := tx.Create(&row).Error; e != nil {
					return e
				}
			} else {
				if e := tx.First(&row, m.RowID).Error; e != nil {
					return e
				}
			}
			state, action := "normal", "release"
			if form.Enabled {
				state, action = "held", "keep"
			}
			if e := tx.Model(&row).Update("status", state).Error; e != nil {
				return e
			}
			if e := terminalEvent(tx, &row, action); e != nil {
				return e
			}
			savedID = row.ID
			return nil
		})
		if e != nil {
			return nil, errors.New("保持设置保存失败")
		}
		m.RowID = savedID
		m.Keep = form.Enabled
	}
	return &managedTerminalView{SessionID: m.ID, ServerID: m.ServerID, ServerName: m.Name, Kind: m.Kind, Keep: m.Keep, RecordID: m.RowID}, nil
}
func resumeNativeTerminal(c *gin.Context) (*managedTerminalView, error) {
	var form struct {
		StreamID string `json:"stream_id"`
	}
	if e := bindTerminalSession(c, &form); e != nil {
		return nil, e
	}
	m, e := managedForRequest(c, form.StreamID)
	if e != nil {
		return nil, e
	}
	if m.Bridge.Attached() {
		return nil, terminalsession.ErrAttached
	}
	return m.view(), nil
}
func stopNativeTerminal(c *gin.Context) (any, error) {
	var form struct {
		StreamID string `json:"stream_id"`
		Confirm  bool   `json:"confirm"`
	}
	if e := bindTerminalSession(c, &form); e != nil {
		return nil, e
	}
	m, e := managedForRequest(c, form.StreamID)
	if e != nil {
		return nil, e
	}
	if !form.Confirm {
		return nil, errors.New("请确认结束会话，这会终止其中的任务")
	}
	if m.Kind != "native" {
		return nil, errors.New("请使用 tmux 会话的结束按钮")
	}
	m.mu.Lock()
	rid := m.RowID
	m.mu.Unlock()
	if rid != 0 {
		var row model.TerminalSession
		if e = singleton.DB.First(&row, rid).Error; e != nil {
			return nil, e
		}
		if e = terminalEvent(singleton.DB, &row, "stop"); e != nil {
			return nil, e
		}
	}
	m.close()
	return nil, nil
}

func terminalSessionOrigin(r *http.Request) bool {
	values := r.Header.Values("Origin")
	if len(values) != 1 {
		return false
	}
	origin, err := url.Parse(values[0])
	if err != nil || origin.User != nil || origin.Path != "" || origin.RawQuery != "" || origin.Fragment != "" {
		return false
	}
	// Legacy TLS proxies may omit X-Forwarded-Proto. Require a web origin and
	// an exact host; reject downgrades whenever the request's HTTPS is known.
	if origin.Scheme != "http" && origin.Scheme != "https" {
		return false
	}
	if (r.TLS != nil || r.URL.Scheme == "https" || r.Header.Get("X-Forwarded-Proto") == "https") && origin.Scheme != "https" {
		return false
	}
	return equalASCIIFold(origin.Host, r.Host)
}
