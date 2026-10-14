package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
)

type deleteDeletedServerRecordRequest struct {
	UUID            string  `json:"uuid" binding:"required"`
	BlockVersion    uint64  `json:"block_version" binding:"required"`
	CleanupRevision *uint64 `json:"cleanup_revision" binding:"required"`
}

// Administrator + admin PAT scope and the standard cookie CSRF middleware.
func deleteDeletedServerRecord(c *gin.Context) (bool, error) {
	var request deleteDeletedServerRecordRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		return false, err
	}
	if err := singleton.DeleteDeletedServerRecord(request.UUID, request.BlockVersion, *request.CleanupRevision, model.ServerOperationActorFromContext(c)); err != nil {
		return false, err
	}
	return true, nil
}
