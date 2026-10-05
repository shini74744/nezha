package controller

import (
	"errors"

	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
)

type deletedCleanupRequest struct {
	UUID         string  `json:"uuid" binding:"required"`
	BlockVersion uint64  `json:"block_version" binding:"required"`
	Revision     *uint64 `json:"cleanup_revision" binding:"required"`
	Enabled      *bool   `json:"enabled" binding:"required"`
}

func configureDeletedCleanup(c *gin.Context) (*model.ServerDeletionTombstone, error) {
	if token := APITokenFromContext(c); token != nil && len(token.ServerIDs()) != 0 {
		return nil, errors.New("已删除节点不能使用按当前服务器 ID 限定的令牌操作")
	}
	var request deletedCleanupRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		return nil, err
	}
	if request.Revision == nil || request.Enabled == nil {
		return nil, errors.New("缺少清理设置")
	}
	row, err := singleton.ConfigureDeletedCleanup(request.UUID, request.BlockVersion, *request.Revision, *request.Enabled, model.ServerOperationActorFromContext(c))
	if err == nil {
		singleton.DescribeDeletedCleanup(row)
	}
	return row, err
}
