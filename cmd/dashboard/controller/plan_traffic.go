package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"time"
)

// showPlanTraffic shares inventory visibility, including hidden-server and PAT
// allowlists. It never exposes UUIDs or another viewer's cached results.
func showPlanTraffic(c *gin.Context) (map[uint64]*model.PlanTrafficStat, error) {
	result := make(map[uint64]*model.PlanTrafficStat)
	now := time.Now()
	for _, server := range singleton.ServerShared.GetList() {
		if !userCanViewServer(c, server) {
			continue
		}
		stat, err := singleton.QueryPlanTraffic(server, now)
		if err != nil {
			return nil, err
		}
		if stat != nil {
			result[server.ID] = stat
		}
	}
	return result, nil
}
