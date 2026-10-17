package controller

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/terminalsession"
	"github.com/nezhahq/nezha/service/rpc"
	"github.com/nezhahq/nezha/service/singleton"
	"gorm.io/gorm"
	"strings"
	"sync"
)

var runTmuxCommand = rpc.RunTerminalManagementCommand
var terminalOps sync.Map

func lockTerminalOperation(identity string) func() {
	v, _ := terminalOps.LoadOrStore(identity, &sync.Mutex{})
	m := v.(*sync.Mutex)
	m.Lock()
	return m.Unlock
}

type terminalListForm struct {
	ServerID uint64 `json:"server_id"`
}
type terminalSessionItem struct {
	model.TerminalSession
	Windows  []terminalsession.Window `json:"windows"`
	Attached bool                     `json:"attached"`
}
type terminalSessionList struct {
	Native    []terminalSessionItem `json:"native"`
	Tmux      []terminalSessionItem `json:"tmux"`
	Installed bool                  `json:"installed"`
	TmuxError string                `json:"tmux_error,omitempty"`
}

func scanTmux(ctx context.Context, s *model.Server) ([]terminalsession.Tmux, bool, error) {
	raw, e := runTmuxCommand(ctx, s, terminalsession.ListTmuxCommand)
	if e != nil {
		return nil, false, e
	}
	return terminalsession.ParseTmux(raw)
}
func syncTmuxRecords(uid uint64, s *model.Server, rows []terminalsession.Tmux) ([]terminalSessionItem, error) {
	if singleton.ServerReplacementClearing(s.UUID) || !s.MachineRuntimeActive() {
		return nil, errors.New("节点正在换机，请稍后刷新")
	}
	result := make([]terminalSessionItem, 0, len(rows))
	err := singleton.DB.Transaction(func(tx *gorm.DB) error {
		var previous []model.TerminalSession
		if e := tx.Where("user_id = ? AND server_uuid = ? AND kind = ?", uid, s.UUID, "tmux").Find(&previous).Error; e != nil {
			return e
		}
		live := map[uint64]bool{}
		for _, remote := range rows {
			var row model.TerminalSession
			for _, p := range previous {
				if p.RemoteID == remote.ID && p.RemoteCreated == remote.Created {
					row = p
					break
				}
			}
			windows, _ := json.Marshal(remote.Windows)
			if row.ID == 0 {
				row = model.TerminalSession{Common: model.Common{UserID: uid}, ServerID: s.ID, ServerUUID: s.UUID, Kind: "tmux", Name: remote.Name, RemoteID: remote.ID, RemoteCreated: remote.Created, Windows: string(windows), Source: "existing", Status: "available"}
				if e := tx.Create(&row).Error; e != nil {
					return e
				}
				if e := terminalEvent(tx, &row, "discover"); e != nil {
					return e
				}
			} else if row.Name != remote.Name || row.Windows != string(windows) || row.Status != "available" || row.ServerID != s.ID {
				row.Name = remote.Name
				row.Windows = string(windows)
				row.Status = "available"
				row.ServerID = s.ID
				if e := tx.Save(&row).Error; e != nil {
					return e
				}
			}
			live[row.ID] = true
			result = append(result, terminalSessionItem{TerminalSession: row, Windows: remote.Windows})
		}
		for _, p := range previous {
			if !live[p.ID] && p.Status != "closed" {
				if e := tx.Model(&p).Update("status", "closed").Error; e != nil {
					return e
				}
			}
		}
		return nil
	})
	return result, err
}
func listTerminalSessions(c *gin.Context) (*terminalSessionList, error) {
	var form terminalListForm
	if e := bindTerminalSession(c, &form); e != nil {
		return nil, e
	}
	u, s, e := terminalAuthorizedServer(c, form.ServerID)
	if e != nil {
		return nil, e
	}
	result := &terminalSessionList{Native: []terminalSessionItem{}, Tmux: []terminalSessionItem{}}
	var native []model.TerminalSession
	if e = singleton.DB.Where("user_id = ? AND server_uuid = ? AND kind = ? AND status = ?", u.ID, s.UUID, "native", "held").Order("id DESC").Find(&native).Error; e != nil {
		return nil, e
	}
	for _, row := range native {
		m := managedLookup(row.StreamID)
		if m == nil || !m.valid() {
			_ = singleton.DB.Model(&row).Update("status", "closed").Error
			continue
		}
		result.Native = append(result.Native, terminalSessionItem{TerminalSession: row, Windows: []terminalsession.Window{}, Attached: m.Bridge.Attached()})
	}
	unlock := lockTerminalOperation(s.UUID)
	defer unlock()
	rows, installed, e := scanTmux(c.Request.Context(), s)
	if e != nil {
		result.TmuxError = e.Error()
		return result, nil
	}
	result.Installed = installed
	result.Tmux, e = syncTmuxRecords(u.ID, s, rows)
	if e != nil {
		return nil, errors.New("会话列表保存失败")
	}
	return result, nil
}

type tmuxActionForm struct {
	ServerID uint64 `json:"server_id"`
	RecordID uint64 `json:"record_id"`
	Name     string `json:"name"`
	Window   string `json:"window"`
	Confirm  bool   `json:"confirm"`
}

func currentTmux(c *gin.Context, form tmuxActionForm) (*model.Server, *model.TerminalSession, terminalsession.Tmux, error) {
	u, s, e := terminalAuthorizedServer(c, form.ServerID)
	if e != nil {
		return nil, nil, terminalsession.Tmux{}, e
	}
	var row model.TerminalSession
	if singleton.DB.Where("id = ? AND user_id = ? AND server_uuid = ? AND kind = ?", form.RecordID, u.ID, s.UUID, "tmux").First(&row).Error != nil {
		return nil, nil, terminalsession.Tmux{}, errors.New("会话不存在或无权访问")
	}
	rows, installed, e := scanTmux(c.Request.Context(), s)
	if e != nil {
		return nil, nil, terminalsession.Tmux{}, e
	}
	if !installed {
		return nil, nil, terminalsession.Tmux{}, errors.New("服务器尚未安装 tmux")
	}
	for _, remote := range rows {
		if remote.ID == row.RemoteID && remote.Created == row.RemoteCreated {
			return s, &row, remote, nil
		}
	}
	return nil, nil, terminalsession.Tmux{}, errors.New("会话已结束，请刷新列表")
}
func createTmuxSession(c *gin.Context) (*managedTerminalView, error) {
	var form tmuxActionForm
	if e := bindTerminalSession(c, &form); e != nil {
		return nil, e
	}
	u, s, e := terminalAuthorizedServer(c, form.ServerID)
	if e != nil {
		return nil, e
	}
	command, e := terminalsession.CreateTmuxCommand(strings.TrimSpace(form.Name), strings.TrimSpace(form.Window))
	if e != nil {
		return nil, e
	}
	unlock := lockTerminalOperation(s.UUID)
	defer unlock()
	if singleton.ServerReplacementClearing(s.UUID) || !s.MachineRuntimeActive() {
		return nil, errors.New("节点正在换机，请稍后刷新")
	}
	// Reserve metadata before remote creation; even a lost response keeps the requested names.
	row := model.TerminalSession{Common: model.Common{UserID: u.ID}, ServerID: s.ID, ServerUUID: s.UUID, Kind: "tmux", Name: strings.TrimSpace(form.Name), CreatedWindowName: strings.TrimSpace(form.Window), Source: "panel", Status: "creating"}
	if e = singleton.DB.Transaction(func(tx *gorm.DB) error {
		if e := tx.Create(&row).Error; e != nil {
			return e
		}
		return terminalEvent(tx, &row, "create_requested")
	}); e != nil {
		return nil, errors.New("会话创建记录保存失败")
	}
	raw, e := runTmuxCommand(c.Request.Context(), s, command)
	if e != nil {
		_ = singleton.DB.Model(&row).Update("status", "unknown").Error
		return nil, e
	}
	parts := strings.Split(strings.TrimSpace(raw), "|")
	if len(parts) != 2 || !strings.HasPrefix(parts[0], "$") {
		_ = singleton.DB.Model(&row).Update("status", "failed").Error
		if strings.Contains(raw, "NZX_MISSING") {
			return nil, errors.New("尚未安装 tmux，请先点击安装")
		}
		return nil, errors.New("创建失败，可能已有同名会话，请刷新列表")
	}
	row.RemoteID = parts[0]
	row.RemoteCreated = parts[1]
	row.Status = "available"
	if _, e = terminalsession.VerifyTmuxCommand(terminalsession.Tmux{ID: row.RemoteID, Created: row.RemoteCreated}); e != nil {
		return nil, e
	}
	if e = singleton.DB.Transaction(func(tx *gorm.DB) error {
		if e := tx.Save(&row).Error; e != nil {
			return e
		}
		return terminalEvent(tx, &row, "created")
	}); e != nil {
		return nil, errors.New("tmux 已创建，但记录保存失败，请刷新列表")
	}
	rows, _, e := scanTmux(c.Request.Context(), s)
	if e != nil {
		return nil, e
	}
	if _, e = syncTmuxRecords(u.ID, s, rows); e != nil {
		return nil, e
	}
	for _, remote := range rows {
		if remote.ID == row.RemoteID && remote.Created == row.RemoteCreated {
			initial, e := terminalsession.AttachTmuxCommand(remote, "")
			if e != nil {
				return nil, e
			}
			return newManagedTerminal(c, s.ID, "tmux", row.ID, initial)
		}
	}
	return nil, errors.New("会话已创建，请刷新列表后进入")
}
func attachTmuxSession(c *gin.Context) (*managedTerminalView, error) {
	var form tmuxActionForm
	if e := bindTerminalSession(c, &form); e != nil {
		return nil, e
	}
	_, server, e := terminalAuthorizedServer(c, form.ServerID)
	if e != nil {
		return nil, e
	}
	unlock := lockTerminalOperation(server.UUID)
	defer unlock()
	s, row, remote, e := currentTmux(c, form)
	if e != nil {
		return nil, e
	}
	initial, e := terminalsession.AttachTmuxCommand(remote, form.Window)
	if e != nil {
		return nil, e
	}
	if e = terminalEvent(singleton.DB, row, "attach"); e != nil {
		return nil, errors.New("会话记录保存失败")
	}
	return newManagedTerminal(c, s.ID, "tmux", row.ID, initial)
}
func endTmuxSession(c *gin.Context) (any, error) {
	var form tmuxActionForm
	if e := bindTerminalSession(c, &form); e != nil {
		return nil, e
	}
	if !form.Confirm {
		return nil, errors.New("请确认结束会话，这会终止其中的任务")
	}
	_, server, e := terminalAuthorizedServer(c, form.ServerID)
	if e != nil {
		return nil, e
	}
	unlock := lockTerminalOperation(server.UUID)
	defer unlock()
	s, row, remote, e := currentTmux(c, form)
	if e != nil {
		return nil, e
	}
	command, e := terminalsession.EndTmuxCommand(remote)
	if e != nil {
		return nil, e
	}
	if e = terminalEvent(singleton.DB, row, "end_requested"); e != nil {
		return nil, e
	}
	if _, e = runTmuxCommand(c.Request.Context(), s, command); e != nil {
		return nil, e
	}
	return nil, singleton.DB.Transaction(func(tx *gorm.DB) error {
		if e := tx.Model(row).Update("status", "closed").Error; e != nil {
			return e
		}
		return terminalEvent(tx, row, "ended")
	})
}
