package controller

import (
	"context"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/panelbackup"
	"github.com/nezhahq/nezha/service/rpc"
	"github.com/nezhahq/nezha/service/singleton"
)

var backupSetupLocks sync.Map

func backupManager(c *gin.Context) (*panelbackup.Manager, error) {
	// A server-scoped token cannot export the whole panel, even with an admin scope.
	if value, ok := c.Get(model.CtxKeyAPIToken); ok {
		token, valid := value.(*model.APIToken)
		if !valid || token == nil || len(token.ServerIDs()) != 0 {
			return nil, errors.New("数据备份需要完整的管理员权限")
		}
	}
	if singleton.BackupManager == nil {
		return nil, errors.New("备份服务暂不可用，请检查面板日志")
	}
	return singleton.BackupManager, nil
}
func backupBind(c *gin.Context, value any) error {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 128*1024)
	return c.ShouldBindJSON(value)
}
func getBackupOverview(c *gin.Context) (any, error) {
	m, e := backupManager(c)
	if e != nil {
		return nil, e
	}
	return m.Overview()
}
func getBackupHistory(c *gin.Context) (any, error) {
	m, e := backupManager(c)
	if e != nil {
		return nil, e
	}
	p, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	n, _ := strconv.Atoi(c.DefaultQuery("page_size", "10"))
	return m.History(p, n)
}
func saveBackupPlan(c *gin.Context) (any, error) {
	m, e := backupManager(c)
	if e != nil {
		return nil, e
	}
	var input struct {
		panelbackup.Plan
		BackupPassword string `json:"backup_password"`
	}
	if e = backupBind(c, &input); e != nil {
		return nil, e
	}
	return nil, m.SavePlan(input.Plan, input.BackupPassword)
}
func saveBackupTarget(c *gin.Context) (any, error) {
	m, e := backupManager(c)
	if e != nil {
		return nil, e
	}
	var input panelbackup.TargetInput
	if e = backupBind(c, &input); e != nil {
		return nil, e
	}
	return m.SaveTarget(input)
}
func deleteBackupTarget(c *gin.Context) (any, error) {
	m, e := backupManager(c)
	if e != nil {
		return nil, e
	}
	id, e := strconv.ParseUint(c.Param("id"), 10, 64)
	if e != nil || id == 0 {
		return nil, errors.New("备份目标无效")
	}
	return nil, m.DeleteTarget(id)
}
func probeBackupTarget(c *gin.Context) (any, error) {
	m, e := backupManager(c)
	if e != nil {
		return nil, e
	}
	var input panelbackup.TargetInput
	if e = backupBind(c, &input); e != nil {
		return nil, e
	}
	target, secret, e := m.ResolveInput(input)
	if e != nil {
		return nil, e
	}
	if target.Fingerprint == "SHA256:pending" {
		target.Fingerprint = ""
	}
	validation := target
	validation.Fingerprint = "SHA256:test"
	if e = panelbackup.ValidateTarget(validation); e != nil {
		return nil, e
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()
	fp, e := panelbackup.Probe(ctx, target, secret)
	if e != nil {
		return nil, e
	}
	return map[string]any{"fingerprint": fp, "message": "连接成功"}, nil
}
func prepareBackupTarget(c *gin.Context) (any, error) {
	m, e := backupManager(c)
	if e != nil {
		return nil, e
	}
	var input panelbackup.TargetInput
	if e = backupBind(c, &input); e != nil {
		return nil, e
	}
	if input.ServerID != 0 {
		server, ok := singleton.ServerShared.Get(input.ServerID)
		if !ok || server == nil || !server.HasPermission(c) {
			return nil, errors.New("无权操作此服务器")
		}
	}
	target, command, e := m.PrepareKey(input)
	if e != nil {
		return nil, e
	}
	return map[string]any{"target": target, "command": command}, nil
}
func setupBackupTarget(c *gin.Context) (any, error) {
	m, e := backupManager(c)
	if e != nil {
		return nil, e
	}
	var input struct {
		ID uint64 `json:"id"`
	}
	if e = backupBind(c, &input); e != nil {
		return nil, e
	}
	target, e := m.Target(input.ID)
	if e != nil || target.ServerID == 0 {
		return nil, errors.New("请选择服务器列表中的机器")
	}
	server, ok := singleton.ServerShared.Get(target.ServerID)
	if !ok || server == nil || !server.HasPermission(c) {
		return nil, errors.New("服务器不存在或无权操作")
	}
	stream := server.GetTaskStream()
	if stream == nil {
		return nil, errors.New("Agent 当前离线，无法自动安装，请等待上线或使用手动安装命令")
	}
	command, e := m.SetupCommand(input.ID)
	if e != nil {
		return nil, e
	}
	if _, loaded := backupSetupLocks.LoadOrStore(target.ServerID, true); loaded {
		return nil, errors.New("此服务器正在对接，请等待完成")
	}
	actor := model.ServerOperationActorFromContext(c)
	if e = model.RecordServerOperationChanges(singleton.DB, actor, "backup_setup", server, 0, []model.ServerOperationChange{{Field: "备份对接", After: "安装专用备份接收端"}}); e != nil {
		backupSetupLocks.Delete(target.ServerID)
		return nil, e
	}
	if e = m.BeginSetup(input.ID); e != nil {
		backupSetupLocks.Delete(target.ServerID)
		return nil, e
	}
	go func() {
		defer backupSetupLocks.Delete(target.ServerID)
		ctx, cancel := context.WithTimeout(context.Background(), 7*time.Minute)
		defer cancel()
		fp := ""
		var failure error
		defer func() {
			if recover() != nil {
				failure = errors.New("安装过程遇到异常，请重新测试连接或重试对接")
			}
			_ = m.FinishSetup(target.ID, fp, failure)
		}()
		output, err := rpc.SetupBackupTargetOnStream(ctx, server, stream, command)
		if err != nil {
			failure = err
			return
		}
		allowed := []string{}
		for _, line := range strings.Split(output, "\n") {
			if strings.HasPrefix(line, "DDNEZHA_BACKUP_HOSTKEY=SHA256:") {
				allowed = append(allowed, strings.TrimSpace(strings.TrimPrefix(line, "DDNEZHA_BACKUP_HOSTKEY=")))
			}
		}
		if len(allowed) == 0 {
			failure = errors.New("接收端已安装，但未取得身份指纹，请重新测试连接")
			return
		}
		t, secret, err := m.ResolveInput(panelbackup.TargetInput{Target: target})
		if err != nil {
			failure = err
			return
		}
		t.Fingerprint = ""
		fp, failure = panelbackup.ProbeTrusted(ctx, t, secret, allowed)
		if failure != nil {
			failure = fmt.Errorf("接收端安装后连接测试失败，请检查备份端口是否允许面板访问：%w", failure)
		}
	}()
	return m.Target(input.ID)
}
func backupTargetStatus(c *gin.Context) (any, error) {
	m, e := backupManager(c)
	if e != nil {
		return nil, e
	}
	id, e := strconv.ParseUint(c.Param("id"), 10, 64)
	if e != nil {
		return nil, e
	}
	return m.Target(id)
}
func backupCommand(c *gin.Context) (any, error) {
	m, e := backupManager(c)
	if e != nil {
		return nil, e
	}
	id, e := strconv.ParseUint(c.Param("id"), 10, 64)
	if e != nil {
		return nil, e
	}
	command, e := m.SetupCommand(id)
	if e != nil {
		return nil, e
	}
	return map[string]string{"command": command}, nil
}
func startBackup(c *gin.Context) (any, error) {
	m, e := backupManager(c)
	if e != nil {
		return nil, e
	}
	var input struct {
		TargetIDs []uint64 `json:"target_ids"`
		RetryOf   uint64   `json:"retry_of"`
	}
	if e = backupBind(c, &input); e != nil {
		return nil, e
	}
	id, e := m.Start("manual", input.TargetIDs, input.RetryOf)
	return map[string]uint64{"id": id}, e
}
func cancelBackup(c *gin.Context) (any, error) {
	m, e := backupManager(c)
	if e != nil {
		return nil, e
	}
	id, e := strconv.ParseUint(c.Param("id"), 10, 64)
	if e != nil {
		return nil, e
	}
	return nil, m.Cancel(id)
}

// downloadBackup uses cookie authentication like the admin UI. Streaming avoids
// buffering multi-gigabyte archives in browser memory or on the panel's disk.
func downloadBackup(c *gin.Context) (any, error) {
	m, err := backupManager(c)
	if err != nil {
		return nil, err
	}
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		return nil, errors.New("备份记录无效")
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 12*time.Hour)
	defer cancel()
	download, err := m.OpenDownload(ctx, id)
	if err != nil {
		c.Header("Cache-Control", "private, no-store")
		c.String(http.StatusBadRequest, "无法下载备份\n\n%s\n\n请返回备份页面，检查目标机器连接后重试。", err.Error())
		return nil, errNoop
	}
	defer download.Close()
	c.Header("Content-Type", "application/octet-stream")
	c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": download.Name}))
	c.Header("Content-Length", strconv.FormatInt(download.Size, 10))
	c.Header("Cache-Control", "private, no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)
	if err = download.Write(ctx, c.Writer); err != nil {
		// Abort the response instead of appending JSON to a partial backup file.
		panic(http.ErrAbortHandler)
	}
	return nil, errNoop
}
