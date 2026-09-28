package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
)

func batchUpdateServerVisibility(c *gin.Context) (*model.BatchServerVisibilityResult, error) {
	var form model.BatchServerVisibilityForm
	if err := c.ShouldBindJSON(&form); err != nil {
		return nil, err
	}
	// Serialize with full server edits so omitted fields cannot be overwritten
	// by an older metadata snapshot during this visibility-only operation.
	logoLibraryMu.Lock()
	defer logoLibraryMu.Unlock()
	serverIDReassignMu.Lock()
	defer serverIDReassignMu.Unlock()
	updated, err := singleton.ServerShared.UpdateVisibility(c, form)
	if err != nil {
		return nil, err
	}
	return &model.BatchServerVisibilityResult{Updated: updated}, nil
}
