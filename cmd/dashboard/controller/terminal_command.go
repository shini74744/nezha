package controller

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

const terminalCommandLimit = 100

var errTerminalCommandConflict = errors.New("命令已被修改或删除，请取消编辑并刷新列表")

// Never include command bodies in SQL logs, even when dashboard debug is enabled.
func terminalCommandDB() *gorm.DB {
	return singleton.DB.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})
}
func terminalCommandOwner(c *gin.Context) (uint64, error) {
	c.Header("Cache-Control", "no-store")
	auth, ok := c.Get(model.CtxKeyAuthorizedUser)
	user, valid := auth.(*model.User)
	if !ok || !valid || user == nil || user.ID == 0 {
		return 0, errors.New("请先登录")
	}
	return user.ID, nil
}
func validateTerminalCommand(form *model.TerminalCommandForm) error {
	form.Name = strings.TrimSpace(form.Name)
	// Reject newlines before trimming: pasting them could execute commands accidentally.
	if !utf8.ValidString(form.Command) || strings.IndexFunc(form.Command, func(r rune) bool { return unicode.IsControl(r) || r == '\u2028' || r == '\u2029' }) >= 0 {
		return errors.New("请输入单行命令，不支持换行或控制字符")
	}
	form.Command = strings.TrimSpace(form.Command)
	if !utf8.ValidString(form.Name) || form.Name == "" || utf8.RuneCountInString(form.Name) > 80 || strings.IndexFunc(form.Name, unicode.IsControl) >= 0 {
		return errors.New("名称需为 1–80 个字符")
	}
	if form.Command == "" || len(form.Command) > 8192 {
		return errors.New("命令不能为空，且不能超过 8192 字节")
	}
	return nil
}
func bindTerminalCommand(c *gin.Context) (model.TerminalCommandForm, error) {
	var form model.TerminalCommandForm
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64*1024)
	if err := c.ShouldBindJSON(&form); err != nil {
		return form, errors.New("命令格式无效或内容过长")
	}
	return form, validateTerminalCommand(&form)
}
func terminalCommandID(c *gin.Context) (uint64, error) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		return 0, errors.New("命令 ID 无效")
	}
	return id, nil
}
func listTerminalCommands(c *gin.Context) ([]model.TerminalCommandView, error) {
	uid, err := terminalCommandOwner(c)
	if err != nil {
		return nil, err
	}
	rows := make([]model.TerminalCommand, 0)
	if err = terminalCommandDB().Where("user_id = ?", uid).Order("id ASC").Find(&rows).Error; err != nil {
		return nil, errors.New("快捷命令加载失败，请重试")
	}
	views := make([]model.TerminalCommandView, 0, len(rows))
	for _, row := range rows {
		command, err := singleton.DecryptTerminalCommand(uid, row.Ciphertext)
		if err != nil {
			return nil, err
		}
		views = append(views, model.TerminalCommandView{ID: row.ID, Name: row.Name, Command: command, Version: row.Version})
	}
	return views, nil
}
func createTerminalCommand(c *gin.Context) (*model.TerminalCommandView, error) {
	uid, err := terminalCommandOwner(c)
	if err != nil {
		return nil, err
	}
	form, err := bindTerminalCommand(c)
	if err != nil {
		return nil, err
	}
	ciphertext, err := singleton.EncryptTerminalCommand(uid, form.Command)
	if err != nil {
		return nil, err
	}
	row := model.TerminalCommand{Common: model.Common{UserID: uid}, Name: form.Name, Ciphertext: ciphertext, Version: 1}
	err = terminalCommandDB().Transaction(func(tx *gorm.DB) error {
		var count int64
		if tx.Model(&model.TerminalCommand{}).Where("user_id = ?", uid).Count(&count).Error != nil {
			return errors.New("快捷命令保存失败，请重试")
		}
		if count >= terminalCommandLimit {
			return errors.New("每个账号最多保存 100 条快捷命令")
		}
		if tx.Create(&row).Error != nil {
			return errors.New("快捷命令保存失败，请重试")
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &model.TerminalCommandView{ID: row.ID, Name: row.Name, Command: form.Command, Version: row.Version}, nil
}
func updateTerminalCommand(c *gin.Context) (*model.TerminalCommandView, error) {
	uid, err := terminalCommandOwner(c)
	if err != nil {
		return nil, err
	}
	id, err := terminalCommandID(c)
	if err != nil {
		return nil, err
	}
	form, err := bindTerminalCommand(c)
	if err != nil {
		return nil, err
	}
	if form.Version == 0 || form.Version >= 1<<53 {
		return nil, errors.New("命令版本无效，请刷新列表")
	}
	ciphertext, err := singleton.EncryptTerminalCommand(uid, form.Command)
	if err != nil {
		return nil, err
	}
	result := terminalCommandDB().Model(&model.TerminalCommand{}).Where("id = ? AND user_id = ? AND version = ?", id, uid, form.Version).Updates(map[string]any{"name": form.Name, "ciphertext": ciphertext, "version": form.Version + 1})
	if result.Error != nil {
		return nil, errors.New("快捷命令保存失败，请重试")
	}
	if result.RowsAffected != 1 {
		return nil, errTerminalCommandConflict
	}
	return &model.TerminalCommandView{ID: id, Name: form.Name, Command: form.Command, Version: form.Version + 1}, nil
}
func deleteTerminalCommand(c *gin.Context) (any, error) {
	uid, err := terminalCommandOwner(c)
	if err != nil {
		return nil, err
	}
	id, err := terminalCommandID(c)
	if err != nil {
		return nil, err
	}
	version, err := strconv.ParseUint(c.Query("version"), 10, 64)
	if err != nil || version == 0 {
		return nil, errors.New("命令版本无效，请刷新列表")
	}
	result := terminalCommandDB().Where("id = ? AND user_id = ? AND version = ?", id, uid, version).Delete(&model.TerminalCommand{})
	if result.Error != nil {
		return nil, errors.New("快捷命令删除失败，请重试")
	}
	if result.RowsAffected != 1 {
		return nil, errTerminalCommandConflict
	}
	return nil, nil
}
