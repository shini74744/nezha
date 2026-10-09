package controller

import (
	"encoding/json"
	"github.com/nezhahq/nezha/service/networkinsight"
	"time"
)

func bgpHasUnavailable(s networkinsight.Snapshot) bool {
	for _, topology := range s.Topologies {
		if topology.Status == "unavailable" {
			return true
		}
	}
	return false
}
func bgpRetryDelay(attempt int) time.Duration {
	switch {
	case attempt <= 1:
		return 5 * time.Minute
	case attempt == 2:
		return 15 * time.Minute
	case attempt == 3:
		return 30 * time.Minute
	default:
		return time.Hour
	}
}
func bgpNextRetry(s networkinsight.Snapshot) int64 {
	if s.ScheduledAt == 0 || s.State != "complete" || !bgpHasUnavailable(s) {
		return 0
	}
	if s.AutoRetryAt > 0 {
		return s.AutoRetryAt
	}
	return s.FinishedAt + bgpRetryDelay(s.AutoAttempt).Milliseconds()
}
func bgpRetryReady(row networkinsight.Record, slot, now int64) bool {
	if row.ScheduledAt != slot {
		return false
	}
	var s networkinsight.Snapshot
	if json.Unmarshal([]byte(row.Payload), &s) != nil {
		return false
	}
	at := bgpNextRetry(s)
	return at > 0 && now >= at
}
func bgpRetainedTopology(previous *networkinsight.Snapshot, family string) (networkinsight.Topology, bool) {
	if previous != nil {
		for _, topology := range previous.Topologies {
			if topology.Family == family && (topology.Status == "ok" || topology.Status == "no_routes") {
				if topology.TestedAt == 0 {
					topology.TestedAt = previous.FinishedAt
				}
				return topology, true
			}
		}
	}
	return networkinsight.Topology{}, false
}
