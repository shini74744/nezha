package controller

import (
	"errors"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/terminalsession"
	"github.com/nezhahq/nezha/service/singleton"
)

type tmuxWindowForm struct {
	ServerID uint64 `json:"server_id"`
	RecordID uint64 `json:"record_id"`
	Window   string `json:"window"`
	Name     string `json:"name"`
	Confirm  bool   `json:"confirm"`
}
type tmuxWindowResult struct {
	SessionClosed bool                     `json:"session_closed"`
	Windows       []terminalsession.Window `json:"windows"`
}

func createTmuxWindow(c *gin.Context) (*tmuxWindowResult, error) { return mutateTmuxWindow(c, false) }
func endTmuxWindow(c *gin.Context) (*tmuxWindowResult, error)    { return mutateTmuxWindow(c, true) }

func mutateTmuxWindow(c *gin.Context, end bool) (*tmuxWindowResult, error) {
	var form tmuxWindowForm
	if err := bindTerminalSession(c, &form); err != nil {
		return nil, err
	}
	if end && !form.Confirm {
		return nil, errors.New("请确认结束窗口，这会终止该窗口中的任务")
	}
	_, server, err := terminalAuthorizedServer(c, form.ServerID)
	if err != nil {
		return nil, err
	}
	unlock := lockTerminalOperation(server.UUID)
	defer unlock()
	s, row, remote, err := currentTmux(c, tmuxActionForm{ServerID: form.ServerID, RecordID: form.RecordID})
	if err != nil {
		return nil, err
	}
	name := strings.TrimSpace(form.Name)
	action := "window_create"
	var command string
	if end {
		win, e := terminalsession.FindTmuxWindow(remote, form.Window)
		if e != nil {
			return nil, e
		}
		name = win.Name
		action = "window_end"
		command, err = terminalsession.EndTmuxWindowCommand(remote, form.Window)
	} else {
		if len(remote.Windows) >= 128 {
			return nil, errors.New("单个会话最多支持 128 个窗口")
		}
		command, err = terminalsession.CreateTmuxWindowCommand(remote, name)
	}
	if err != nil {
		return nil, err
	}
	event := func(suffix string) error {
		return singleton.DB.Create(&model.TerminalSessionEvent{
			Common: model.Common{UserID: row.UserID}, SessionID: row.ID, ServerUUID: row.ServerUUID,
			Action: action + suffix, Name: remote.Name, WindowName: name,
		}).Error
	}
	if err = event("_requested"); err != nil {
		return nil, errors.New("窗口操作记录保存失败")
	}
	raw, err := runTmuxCommand(c.Request.Context(), s, command)
	if err != nil {
		return nil, err
	}
	if end {
		if err = terminalsession.ParseEndedWindow(raw); err != nil {
			return nil, err
		}
	} else {
		if _, err = terminalsession.ParseCreatedWindow(raw); err != nil {
			return nil, err
		}
	}
	if err = event("_completed"); err != nil {
		return nil, errors.New("窗口操作已执行，但记录保存失败，请刷新列表")
	}
	remotes, installed, err := scanTmux(c.Request.Context(), s)
	if err != nil || !installed {
		return nil, errors.New("窗口操作已执行，但列表刷新失败，请手动刷新确认")
	}
	if _, err = syncTmuxRecords(row.UserID, s, remotes); err != nil {
		return nil, errors.New("窗口操作已执行，但列表保存失败，请手动刷新确认")
	}
	result := &tmuxWindowResult{SessionClosed: true, Windows: []terminalsession.Window{}}
	for _, item := range remotes {
		if item.ID == remote.ID && item.Created == remote.Created {
			result.SessionClosed = false
			result.Windows = item.Windows
			break
		}
	}
	return result, nil
}
