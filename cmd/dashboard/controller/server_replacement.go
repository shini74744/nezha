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
		UUID      string `json:"uuid" binding:"required"`
		Confirmed bool   `json:"confirmed"`
	}
	if err := c.ShouldBindJSON(&form); err != nil {
		return nil, err
	}
	if !form.Confirmed {
		return nil, errors.New("请确认换机清理范围")
	}
	secret, expires, err := singleton.IssueServerReplacement(form.UUID, model.ServerOperationActorFromContext(c))
	if err != nil {
		return nil, err
	}
	return gin.H{"secret": secret, "expires_at": expires}, nil
}
