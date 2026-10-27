package monitor

import (
	"context"
	"github.com/hashicorp/go-uuid"
	"github.com/nezhahq/agent/model"
	"github.com/nezhahq/agent/pkg/monitor/nic"
	"github.com/nezhahq/agent/pkg/util"
	"time"
)

var networkNow = time.Now

// Guarded by metricLock together with counters and the sample timestamp.
var networkSample nic.Sample
var networkCounterEpoch string

func TrackNetworkSpeed(config *model.AgentConfig) {
	var allow map[string]bool
	if config != nil {
		allow = config.NICAllowlist
	}
	current, err := nicStateProbe(context.WithValue(context.Background(), nic.NICKey, allow))
	if err != nil {
		return
	}
	now := uint64(networkNow().Unix())
	metricLock.Lock()
	defer metricLock.Unlock()
	changed := networkCounterEpoch == "" || !current.ContinuousFrom(networkSample)
	if changed {
		epoch, err := uuid.GenerateUUID()
		if err != nil {
			return
		}
		networkCounterEpoch = epoch
		netInSpeed, netOutSpeed = 0, 0
	} else if diff := util.SubUintChecked(now, lastUpdateNetStats); diff > 0 {
		netInSpeed = (current.In - netInTransfer) / diff
		netOutSpeed = (current.Out - netOutTransfer) / diff
	}
	networkSample = current
	netInTransfer, netOutTransfer = current.In, current.Out
	lastUpdateNetStats = now
}
