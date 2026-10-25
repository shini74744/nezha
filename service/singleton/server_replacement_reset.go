package singleton

import (
	"fmt"
	"log"
	"time"

	"github.com/nezhahq/nezha/model"
	"github.com/robfig/cron/v3"
	"gorm.io/gorm"
)

// resetReplacementNode is called only for a versioned full-reset ticket. UUID
// history is never deleted by numeric ID, which may have belonged to other nodes.
func resetReplacementNode(tx *gorm.DB, server *model.Server, issuedAt time.Time) (func(), error) {
	id, uuid := server.ID, server.UUID
	for _, table := range []any{&model.OnlineSession{}, &model.OnlineHistoryCoverage{}} {
		if tx.Migrator().HasTable(table) {
			if err := tx.Where("server_id = ?", id).Delete(table).Error; err != nil {
				return nil, err
			}
		}
	}
	for _, target := range []any{
		&model.ServerOperationLog{}, &model.ServerInventoryBaseline{},
		&model.TerminalSessionEvent{}, &model.TerminalSession{},
	} {
		if tx.Migrator().HasTable(target) {
			if err := tx.Unscoped().Where("server_uuid = ?", uuid).Delete(target).Error; err != nil {
				return nil, err
			}
		}
	}
	for _, target := range []any{&model.ServerExpiryDelivery{}, &model.UnknownAgentReport{}, &model.AgentCredentialRejection{}} {
		if tx.Migrator().HasTable(target) {
			if err := tx.Unscoped().Where("uuid = ?", uuid).Delete(target).Error; err != nil {
				return nil, err
			}
		}
	}
	var natIDs []uint64
	if err := tx.Model(&model.NAT{}).Where("server_id = ?", id).Pluck("id", &natIDs).Error; err != nil {
		return nil, err
	}
	for _, target := range []any{&model.ServerGroupServer{}, &model.NAT{}, &model.ServerTransfer{}, &model.MCPAuditLog{}} {
		if err := tx.Unscoped().Where("server_id = ?", id).Delete(target).Error; err != nil {
			return nil, err
		}
	}
	// Strip only this node's explicit references. Shared objects and "all
	// servers" policies survive, exactly as for a newly registered server.
	deleted := map[uint64]struct{}{id: {}}
	scheduleParser := cron.NewParser(cron.Second | cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow | cron.Descriptor)
	var crons, changedCrons []*model.Cron
	if err := tx.Find(&crons).Error; err != nil {
		return nil, err
	}
	for _, cr := range crons {
		next, changed := removeIDs(cr.Servers, deleted)
		if changed {
			if cr.TaskType != model.CronTypeTriggerTask {
				if _, err := scheduleParser.Parse(cr.Scheduler); err != nil {
					return nil, fmt.Errorf("cron %d requires a valid schedule before replacement: %w", cr.ID, err)
				}
			}
			cr.Servers = next
			if err := tx.Save(cr).Error; err != nil {
				return nil, err
			}
			changedCrons = append(changedCrons, cr)
		}
	}
	var services, changedServices []*model.Service
	if err := tx.Find(&services).Error; err != nil {
		return nil, err
	}
	for _, service := range services {
		if removeIDMap(service.SkipServers, deleted) {
			if _, err := scheduleParser.Parse(service.CronSpec()); err != nil {
				return nil, err
			}
			if err := tx.Save(service).Error; err != nil {
				return nil, err
			}
			changedServices = append(changedServices, service)
		}
	}
	var alerts, changedAlerts []*model.AlertRule
	if err := tx.Find(&alerts).Error; err != nil {
		return nil, err
	}
	for _, alert := range alerts {
		changed := false
		for _, rule := range alert.Rules {
			if rule != nil && removeIDMap(rule.Ignore, deleted) {
				changed = true
			}
		}
		if changed {
			if err := tx.Save(alert).Error; err != nil {
				return nil, err
			}
			changedAlerts = append(changedAlerts, alert)
		}
	}
	var tokens []model.APIToken
	if err := tx.Find(&tokens).Error; err != nil {
		return nil, err
	}
	for _, token := range tokens {
		next, changed := removeIDs(token.ServerIDs(), deleted)
		if !changed {
			continue
		}
		token.SetServerIDs(next)
		// Empty means unrestricted: never widen a token when its last node goes.
		if len(next) == 0 {
			if err := tx.Delete(&model.APIToken{}, token.ID).Error; err != nil {
				return nil, err
			}
		} else if err := tx.Model(&model.APIToken{}).Where("id = ?", token.ID).Update("servers_csv", token.ServersCSV).Error; err != nil {
			return nil, err
		}
	}
	// Map updates intentionally include zero values. Identity, owner, display
	// position, and identity creation metadata are not editable reset fields.
	defaults := map[string]any{
		"name": installationCommandServerName(issuedAt), "note": "", "public_note": "",
		"hide_for_guest": false, "hide_for_display": false,
		"connectivity_disabled": false, "connectivity_local_only": false,
		"network_default_view": "connectivity", "network_display_mode": "",
		"bgp_disabled": false, "return_route_disabled": false, "streaming_disabled": false,
		"EnableDDNS": false, "ddns_profiles_raw": "[]", "override_ddns_domains_raw": "{}",
		"machine_generation": server.MachineGeneration + 1,
	}
	if err := tx.Model(&model.Server{}).Where("id = ? AND uuid = ? AND user_id = ?", id, uuid, server.UserID).Updates(defaults).Error; err != nil {
		return nil, err
	}
	// Re-read into a fresh value so ignored runtime/config fields cannot survive.
	var clean model.Server
	if err := tx.First(&clean, "id = ? AND uuid = ?", id, uuid).Error; err != nil {
		return nil, err
	}
	// Avoid copying Server's atomic runtime holders.
	server.Name, server.Note, server.PublicNote = clean.Name, clean.Note, clean.PublicNote
	server.HideForGuest, server.HideForDisplay = clean.HideForGuest, clean.HideForDisplay
	server.ConnectivityDisabled, server.ConnectivityLocalOnly = clean.ConnectivityDisabled, clean.ConnectivityLocalOnly
	server.NetworkDefaultView, server.NetworkDisplayMode = clean.NetworkDefaultView, clean.NetworkDisplayMode
	server.BGPDisabled, server.ReturnRouteDisabled, server.StreamingDisabled = clean.BGPDisabled, clean.ReturnRouteDisabled, clean.StreamingDisabled
	server.EnableDDNS, server.DDNSProfilesRaw, server.OverrideDDNSDomainsRaw = clean.EnableDDNS, clean.DDNSProfilesRaw, clean.OverrideDDNSDomainsRaw
	server.DDNSProfiles, server.OverrideDDNSDomains = clean.DDNSProfiles, clean.OverrideDDNSDomains
	server.MachineGeneration, server.UpdatedAt = clean.MachineGeneration, clean.UpdatedAt

	return func() {
		if OnlineHistoryShared != nil {
			OnlineHistoryShared.Forget([]uint64{id})
		}
		if NATShared != nil && len(natIDs) > 0 {
			NATShared.Delete(natIDs)
		}
		if ServerTransferShared != nil {
			ServerTransferShared.OnServersDeleted([]uint64{id})
		}
		if CronShared != nil {
			for _, cr := range changedCrons {
				if err := CronShared.ReplaceAfterReferenceCleanup(cr, id); err != nil {
					log.Printf("NEZHA>> refresh cron %d after replacement: %v", cr.ID, err)
				}
			}
			CronShared.pendingAlertTriggerTasksMu.Lock()
			for _, byServer := range CronShared.pendingAlertTriggerTasks {
				delete(byServer, id)
			}
			CronShared.pendingAlertTriggerTasksMu.Unlock()
		}
		if ServiceSentinelShared != nil {
			for _, service := range changedServices {
				if err := ServiceSentinelShared.Update(service); err != nil {
					log.Printf("NEZHA>> refresh service %d after replacement: %v", service.ID, err)
				}
			}
			if len(changedServices) > 0 {
				ServiceSentinelShared.UpdateServiceList()
			}
		}
		AlertsLock.Lock()
		defer AlertsLock.Unlock()
		// Preserve every other node's alert state/counters; do not call the
		// whole-rule reset helper when only one explicit reference changed.
		for _, changed := range changedAlerts {
			for i, alert := range Alerts {
				if alert != nil && alert.ID == changed.ID {
					Alerts[i] = changed
				}
			}
		}
		for _, byServer := range alertsStore {
			delete(byServer, id)
		}
		for _, byServer := range alertsPrevState {
			delete(byServer, id)
		}
	}, nil
}

// The configuration file and TSDB are separate durable stores. A clearing
// journal blocks old credentials and makes this step safely retryable after a
// crash; no full reset ever runs automatically just because the app upgraded.
func ResetReplacementIPNotification(id uint64) error {
	if Conf == nil || Conf.Config == nil {
		return nil
	}
	next, changed := removeIDsFromCSV(Conf.IgnoredIPNotification, map[uint64]struct{}{id: {}})
	if !changed {
		return nil
	}
	old := Conf.IgnoredIPNotification
	Conf.IgnoredIPNotification = next
	if err := Conf.Save(); err != nil {
		Conf.IgnoredIPNotification = old
		Conf.updateIgnoredIPNotificationID()
		return fmt.Errorf("reset node IP notification selection: %w", err)
	}
	return nil
}

// A reset starts with a clean inventory baseline. Subsequent fresh reports may
// record new events, but never compare with any values from the previous machine.
func seedReplacementInventory(tx *gorm.DB, server *model.Server, host *model.Host) error {
	return model.SeedServerInventoryBaseline(tx, server.UUID, model.HostInventoryValues(host))
}
