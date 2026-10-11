package controller

import (
	"context"
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/terminalsession"
	"github.com/nezhahq/nezha/service/rpc"
	"github.com/nezhahq/nezha/service/singleton"
	"strings"
	"sync"
	"time"
)

type tmuxInstallView struct {
	State   string `json:"state"`
	Message string `json:"message"`
}
type tmuxInstallJob struct {
	View    tmuxInstallView
	Owner   uint64
	Started time.Time
}

var tmuxInstalls = struct {
	sync.Mutex
	rows map[string]*tmuxInstallJob
}{rows: map[string]*tmuxInstallJob{}}
var runTmuxInstall = rpc.RunTerminalInstallCommand

func installResult(raw string, err error) tmuxInstallView {
	if err != nil {
		return tmuxInstallView{"failed", err.Error() + "；结果未确认，请刷新检查后再尝试"}
	}
	code := strings.TrimSpace(raw)
	if code == "NZX_INSTALLED" {
		return tmuxInstallView{"done", "tmux 已安装，可以创建会话"}
	}
	messages := map[string]string{
		"NZX_PERMISSION":   "安装需要节点上的 root 权限，或文件系统不允许写入",
		"NZX_TIMEOUT_TOOL": "节点缺少 timeout 命令，无法安全限制安装时长，请手动安装 tmux",
		"NZX_DISK":         "节点磁盘空间不足",
		"NZX_LOCK":         "其他软件安装正在占用包管理器，请稍后重试",
		"NZX_DNS":          "节点无法解析软件源域名，请检查 DNS",
		"NZX_NETWORK":      "软件源连接失败或网络超时，请检查节点网络",
		"NZX_TIMEOUT":      "安装超过 5 分钟，可能网络过慢或包管理器繁忙；请刷新检查结果",
		"NZX_REPOSITORY":   "软件源不可用、签名校验失败或源中没有 tmux",
		"NZX_UNSUPPORTED":  "暂不支持此系统的包管理器，请手动安装 tmux",
		"NZX_PACKAGE":      "包管理器安装失败，请检查节点的软件包状态",
	}
	message, ok := messages[code]
	if !ok {
		message = "未能确认安装结果，请刷新检查"
	}
	return tmuxInstallView{"failed", message}
}
func installTmux(c *gin.Context) (*tmuxInstallView, error) {
	var form struct {
		ServerID uint64 `json:"server_id"`
		Confirm  bool   `json:"confirm"`
	}
	if e := bindTerminalSession(c, &form); e != nil {
		return nil, e
	}
	u, s, e := terminalAuthorizedServer(c, form.ServerID)
	if e != nil {
		return nil, e
	}
	if !form.Confirm {
		return nil, errors.New("请确认在此节点安装 tmux 及必要依赖")
	}
	if s.GetTaskStream() == nil {
		return nil, errors.New("服务器离线")
	}
	tmuxInstalls.Lock()
	for id, old := range tmuxInstalls.rows {
		if old.View.State != "running" && time.Since(old.Started) > time.Hour {
			delete(tmuxInstalls.rows, id)
		}
	}
	if job := tmuxInstalls.rows[s.UUID]; job != nil && (job.View.State == "running" || time.Since(job.Started) < time.Minute) {
		v := job.View
		tmuxInstalls.Unlock()
		return &v, nil
	}
	job := &tmuxInstallJob{View: tmuxInstallView{"running", "正在安装 tmux，请稍候"}, Owner: u.ID, Started: time.Now()}
	tmuxInstalls.rows[s.UUID] = job
	tmuxInstalls.Unlock()
	audit := model.TerminalSessionEvent{Common: model.Common{UserID: u.ID}, ServerUUID: s.UUID, Action: "install_tmux", Name: "tmux"}
	if e = singleton.DB.Create(&audit).Error; e != nil {
		tmuxInstalls.Lock()
		delete(tmuxInstalls.rows, s.UUID)
		tmuxInstalls.Unlock()
		return nil, errors.New("安装记录保存失败")
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 335*time.Second)
		defer cancel()
		raw, err := runTmuxInstall(ctx, s, terminalsession.InstallTmuxCommand)
		v := installResult(raw, err)
		tmuxInstalls.Lock()
		job.View = v
		tmuxInstalls.Unlock()
	}()
	v := tmuxInstallView{"running", "正在安装 tmux，请稍候"}
	return &v, nil
}
func tmuxInstallStatus(c *gin.Context) (*tmuxInstallView, error) {
	var form terminalListForm
	if e := bindTerminalSession(c, &form); e != nil {
		return nil, e
	}
	_, s, e := terminalAuthorizedServer(c, form.ServerID)
	if e != nil {
		return nil, e
	}
	tmuxInstalls.Lock()
	defer tmuxInstalls.Unlock()
	if job := tmuxInstalls.rows[s.UUID]; job != nil {
		v := job.View
		return &v, nil
	}
	return &tmuxInstallView{"idle", ""}, nil
}
