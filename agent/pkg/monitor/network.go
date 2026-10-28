package monitor

import (
	"context"
	"github.com/hashicorp/go-uuid"
	"github.com/nezhahq/agent/model"
	"github.com/nezhahq/agent/pkg/monitor/nic"
	"github.com/nezhahq/agent/pkg/util"
	"sort"
	"time"
)

var networkNow = time.Now

// Guarded by metricLock together with counters and the sample timestamp.
var networkSample nic.Sample
var networkCounterEpoch string
var networkInterfaceSpeeds []model.NetworkInterfaceSpeed

func TrackNetworkSpeed(config *model.AgentConfig) {
	var allow map[string]bool
	if config != nil {
		allow = config.NICAllowlist
	}
	current, err := nicStateProbe(context.WithValue(context.Background(), nic.NICKey, allow))
	if err != nil {
		metricLock.Lock()
		for i := range networkInterfaceSpeeds {
			networkInterfaceSpeeds[i].Available = false
		}
		metricLock.Unlock()
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
	names := make([]string, 0, len(current.Interfaces))
	for name := range current.Interfaces {
		names = append(names, name)
	}
	sort.Strings(names)
	if len(names) > 256 {
		names = names[:256]
	}
	rates := make([]model.NetworkInterfaceSpeed, 0, len(names))
	diff := util.SubUintChecked(now, lastUpdateNetStats)
	for _, name := range names {
		row := model.NetworkInterfaceSpeed{Name: name}
		cur := current.Interfaces[name]
		old, ok := networkSample.Interfaces[name]
		if !changed && diff > 0 && ok && cur.Index == old.Index && cur.In >= old.In && cur.Out >= old.Out {
			row.Available = true
			row.InSpeed = (cur.In - old.In) / diff
			row.OutSpeed = (cur.Out - old.Out) / diff
		}
		rates = append(rates, row)
	}
	networkInterfaceSpeeds = rates
	networkSample = current
	netInTransfer, netOutTransfer = current.In, current.Out
	lastUpdateNetStats = now
}
