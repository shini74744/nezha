package controller

import (
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/service/networkinsight"
	"github.com/nezhahq/nezha/service/rpc"
	"net/netip"
	"time"
)

// Only configured IDs/families are accepted, never browser-supplied destinations.
func startReturnRouteTarget(c *gin.Context) (*insightResponse, error) {
	s, err := insightServer(c, "return-route")
	if err != nil {
		return nil, err
	}
	if !canRunConnectivity(c, s) {
		return nil, errors.New("permission denied")
	}
	if c.Request.ContentLength != 0 || len(c.Request.TransferEncoding) > 0 || c.Request.URL.RawQuery != "" {
		return nil, errors.New("检测不接受自定义地址或命令")
	}
	if !rpc.ConnectivityOnline(s) {
		return nil, errors.New("节点离线，无法发起检测")
	}
	selection := &networkinsight.ReturnSelection{ID: c.Param("target"), Family: c.Param("family")}
	if err = launchInsightSelected(s, "return-route", false, selection, callerIsAdmin(c)); err != nil {
		return nil, err
	}
	return readInsight(c, "return-route")
}
func returnSelectionAllowed(p networkinsight.ReturnPolicy, families []string, s networkinsight.ReturnSelection) bool {
	for _, r := range networkinsight.EmptyReturnRoutes(p, families) {
		if r.ID == s.ID && r.Family == s.Family {
			return true
		}
	}
	return false
}
func returnJobCovers(active, requested *networkinsight.ReturnSelection) bool {
	return active == nil || (requested != nil && *active == *requested)
}

// Single retests create new snapshots and retain still-configured results with
// their original measurement times. Historical records are never rewritten.
func prepareReturnRetest(latest networkinsight.Snapshot, p networkinsight.ReturnPolicy, families []string, selection *networkinsight.ReturnSelection) []networkinsight.ReturnResult {
	configured := networkinsight.EmptyReturnRoutes(p, families)
	if selection == nil {
		return configured
	}
	results := make([]networkinsight.ReturnResult, 0, len(configured))
	for _, item := range configured {
		if item.ID == selection.ID && item.Family == selection.Family {
			results = append(results, item)
			continue
		}
		for _, old := range latest.Routes {
			a, ae := netip.ParseAddr(old.Target)
			b, be := netip.ParseAddr(item.Target)
			if old.ID == item.ID && old.Family == item.Family && old.Protocol == item.Protocol && ae == nil && be == nil && a.Unmap() == b.Unmap() {
				old.Name = item.Name
				old.Carrier = item.Carrier
				if old.TestedAt == 0 {
					old.TestedAt = latest.FinishedAt
				}
				// Do not renew expired measurements by repeatedly retesting a different target.
				if old.TestedAt < time.Now().Add(-time.Duration(p.RetentionDays)*24*time.Hour).UnixMilli() {
					break
				}
				results = append(results, old)
				break
			}
		}
	}
	return results
}
