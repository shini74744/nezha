package controller

import (
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
)

func createServerReplacement(c *gin.Context) (any, error) {
	c.Header("Cache-Control", "no-store")
	var form struct {
		UUID       string `json:"uuid" binding:"required"`
		Confirmed  bool   `json:"confirmed"`
		ResetScope string `json:"reset_scope"`
	}
	if err := c.ShouldBindJSON(&form); err != nil {
		return nil, err
	}
	if !form.Confirmed || form.ResetScope != singleton.FullNodeReplacementScope {
		return nil, errors.New("请刷新页面并确认：清空全部节点历史、配置及关联，仅保留 ID、UUID、排序和所属账号")
	}
	secret, expires, err := singleton.IssueServerReplacement(form.UUID, model.ServerOperationActorFromContext(c))
	if err != nil {
		return nil, err
	}
	return gin.H{"secret": secret, "expires_at": expires}, nil
}
