package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
)

type releaseDeletedAgentUUIDRequest struct {
	UUID         string `json:"uuid" binding:"required"`
	BlockVersion uint64 `json:"block_version" binding:"required"`
}

// The route requires an administrator and, for PATs, admin scope. Existing
// cookie-authenticated write middleware enforces CSRF; no GET can release a UUID.
func releaseDeletedAgentUUID(c *gin.Context) (*model.ServerDeletionTombstone, error) {
	var request releaseDeletedAgentUUIDRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		return nil, err
	}
	return singleton.ReleaseDeletedServerUUID(request.UUID, request.BlockVersion, model.ServerOperationActorFromContext(c))
}
