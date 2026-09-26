package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"strconv"
)

// getServerLastReport returns a persisted pre-offline snapshot and recent history.
// @Summary Get last recorded server state
// @Description Returns the frozen last minute with the same server visibility/PAT scope and host redaction as live data. Older TSDB fallback/history keeps 1d guest/30d member limits.
// @Tags common
// @Security BearerAuth
// @Param id path uint true "Server ID"
// @Produce json
// @Success 200 {object} model.CommonResponse[model.ServerLastReport]
// @Router /server/{id}/last-report [get]
func getServerLastReport(c *gin.Context) (*model.ServerLastReport, error) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		return nil, err
	}
	server, ok := singleton.ServerShared.Get(id)
	if !ok {
		return nil, singleton.Localizer.ErrorT("server not found")
	}
	if !userCanViewServer(c, server) {
		return nil, singleton.Localizer.ErrorT("unauthorized")
	}
	uuid := server.UUID
	days := 1
	var viewerID uint64
	if user, member := c.Get(model.CtxKeyAuthorizedUser); member {
		days = 30
		viewerID = user.(*model.User).ID
	}
	result, err := singleton.QueryServerSnapshot(id, uuid, days)
	if err != nil {
		return nil, err
	}
	if result == nil {
		result = &model.ServerLastReport{ServerID: id, HistoryDays: days, Metrics: map[string]float64{}, Recent: map[string][]model.ServerMetricsDataPoint{}}
	}
	if result.Snapshot == nil && singleton.TSDBEnabled() {
		result, err = singleton.TSDBShared.QueryLastServerReport(id, days)
		if err != nil {
			return nil, err
		}
	}
	// A concurrent deletion, ID reassignment or visibility change must not leak records.
	current, ok := singleton.ServerShared.Get(id)
	if !ok || current.UUID != uuid || !userCanViewServer(c, current) {
		return nil, singleton.Localizer.ErrorT("unauthorized")
	}
	if result.Snapshot != nil && result.Snapshot.Host != nil && !callerIsAdmin(c) && (viewerID == 0 || viewerID != current.GetUserID()) {
		result.Snapshot.Host = result.Snapshot.Host.Filter()
	}
	return result, nil
}
