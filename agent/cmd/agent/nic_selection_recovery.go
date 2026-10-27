package main

import (
	"context"
	"github.com/hashicorp/go-uuid"
	"github.com/nezhahq/agent/model"
	"github.com/nezhahq/agent/pkg/monitor/nic"
	psnet "github.com/shirou/gopsutil/v4/net"
	"sync"
	"time"
)

var nicRecovery struct {
	sync.Mutex
	lastCheck time.Time
	detector  nic.SelectionRecovery
}

// The daemon owns discovery; normal task/configuration reloads retain their
// existing locking and take precedence over an automatic fallback.
func recoverMissingNICSelection(ctx context.Context, config *model.AgentConfig, now time.Time) {
	nicRecovery.Lock()
	defer nicRecovery.Unlock()
	if now.Sub(nicRecovery.lastCheck) < 10*time.Second {
		return
	}
	nicRecovery.lastCheck = now
	hasSelection := false
	for _, on := range config.NICAllowlist {
		hasSelection = hasSelection || on
	}
	if !hasSelection {
		nicRecovery.detector = nic.SelectionRecovery{}
		return
	}
	probe, cancel := context.WithTimeout(ctx, 3*time.Second)
	rows, err := psnet.InterfacesWithContext(probe)
	cancel()
	names := make([]string, 0, len(rows))
	for _, row := range rows {
		names = append(names, row.Name)
	}
	if !nicRecovery.detector.Observe(config.NICAllowlist, names, err == nil, now) {
		return
	}
	if err = commitNICSelectionReset(config); err != nil {
		printf("Restore NIC monitoring defaults failed: %v", err)
	}
}
func commitNICSelectionReset(expected *model.AgentConfig) error {
	reloadMu.Lock()
	defer reloadMu.Unlock()
	if loadRuntimeConfig() != expected || reloadTimer != nil {
		return nil
	}
	id, err := uuid.GenerateUUID()
	if err != nil {
		return err
	}
	if err = expected.SaveNICSelectionReset(id); err != nil {
		return err
	}
	next := expected.Clone()
	next.NICAllowlist = nil
	next.NICSelectionResetID = id
	// Running workers only consume this immutable snapshot.
	publishRuntimeConfig(next)
	return nil
}
