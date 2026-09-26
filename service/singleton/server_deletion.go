package singleton

import (
	"fmt"
	"log"
	"slices"
	"strconv"
	"strings"
	"sync"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/nezhahq/nezha/model"
)

// ServerMutationMu serializes permanent deletion with allocation of a new
// server ID. It guarantees that a just-freed gap cannot be claimed until all
// old records and TSDB series for that ID have been removed.
var ServerMutationMu sync.Mutex

var deletedServerUUIDs = struct {
	sync.RWMutex
	values map[string]struct{}
}{values: make(map[string]struct{})}

func initDeletedServerUUIDs() error {
	var tombstones []model.ServerDeletionTombstone
	if err := DB.Find(&tombstones).Error; err != nil {
		return err
	}
	deletedServerUUIDs.Lock()
	deletedServerUUIDs.values = make(map[string]struct{}, len(tombstones))
	for _, tombstone := range tombstones {
		deletedServerUUIDs.values[tombstone.UUID] = struct{}{}
	}
	deletedServerUUIDs.Unlock()
	return nil
}

func IsDeletedServerUUID(uuid string) bool {
	deletedServerUUIDs.RLock()
	_, ok := deletedServerUUIDs.values[uuid]
	deletedServerUUIDs.RUnlock()
	return ok
}

func blockDeletedServerUUIDs(uuids []string) []string {
	added := make([]string, 0, len(uuids))
	deletedServerUUIDs.Lock()
	for _, uuid := range uuids {
		if uuid == "" {
			continue
		}
		if _, exists := deletedServerUUIDs.values[uuid]; exists {
			continue
		}
		deletedServerUUIDs.values[uuid] = struct{}{}
		added = append(added, uuid)
	}
	deletedServerUUIDs.Unlock()
	return added
}

func unblockDeletedServerUUIDs(uuids []string) {
	deletedServerUUIDs.Lock()
	for _, uuid := range uuids {
		delete(deletedServerUUIDs.values, uuid)
	}
	deletedServerUUIDs.Unlock()
}

// CreateServerWithLowestAvailableID registers a new Agent using the smallest
// positive system ID not currently present in servers (1, 2, 3, ...).
// Caller must hold ServerMutationMu and must have rechecked the UUID blocklist.
func CreateServerWithLowestAvailableID(userID uint64, uuid, name string) (*model.Server, error) {
	var server model.Server
	err := DB.Transaction(func(tx *gorm.DB) error {
		var ids []uint64
		if err := tx.Model(&model.Server{}).Order("id ASC").Pluck("id", &ids).Error; err != nil {
			return err
		}
		nextID := uint64(1)
		for _, id := range ids {
			if id < nextID {
				continue
			}
			if id == nextID {
				nextID++
				continue
			}
			break
		}
		server = model.Server{
			Common: model.Common{ID: nextID, UserID: userID},
			UUID:   uuid,
			Name:   name,
		}
		return tx.Create(&server).Error
	})
	if err != nil {
		return nil, err
	}
	return &server, nil
}

func removeIDs(values []uint64, deleted map[uint64]struct{}) ([]uint64, bool) {
	out := make([]uint64, 0, len(values))
	changed := false
	for _, value := range values {
		if _, remove := deleted[value]; remove {
			changed = true
			continue
		}
		out = append(out, value)
	}
	return out, changed
}

func removeIDMap(values map[uint64]bool, deleted map[uint64]struct{}) bool {
	changed := false
	for id := range deleted {
		if _, exists := values[id]; exists {
			delete(values, id)
			changed = true
		}
	}
	return changed
}

func removeIDsFromCSV(raw string, deleted map[uint64]struct{}) (string, bool) {
	if strings.TrimSpace(raw) == "" {
		return raw, false
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	changed := false
	for _, part := range parts {
		id, err := strconv.ParseUint(strings.TrimSpace(part), 10, 64)
		if err == nil {
			if _, remove := deleted[id]; remove {
				changed = true
				continue
			}
		}
		out = append(out, strings.TrimSpace(part))
	}
	return strings.Join(out, ","), changed
}

// PermanentlyDeleteServers removes server rows, every direct server_id row,
// every persisted ID reference that could be inherited after ID reuse, and all
// TSDB series. The deleted UUID is kept only as a permanent registration block.
func PermanentlyDeleteServers(ids []uint64) error {
	if len(ids) == 0 {
		return nil
	}
	ids = slices.Compact(slices.Sorted(slices.Values(ids)))

	ServerMutationMu.Lock()
	defer ServerMutationMu.Unlock()

	var servers []model.Server
	if err := DB.Where("id IN ?", ids).Find(&servers).Error; err != nil {
		return err
	}
	if len(servers) == 0 {
		return nil
	}

	actualIDs := make([]uint64, 0, len(servers))
	uuids := make([]string, 0, len(servers))
	deletedIDs := make(map[uint64]struct{}, len(servers))
	for i := range servers {
		actualIDs = append(actualIDs, servers[i].ID)
		uuids = append(uuids, servers[i].UUID)
		deletedIDs[servers[i].ID] = struct{}{}
	}

	// Close the live state/task holders before destructive storage work. The
	// UUID block prevents a reconnect from attaching a replacement stream.
	addedBlocks := blockDeletedServerUUIDs(uuids)
	for i := range servers {
		if running, ok := ServerShared.Get(servers[i].ID); ok && running != nil {
			running.RevokeStreams()
		}
	}

	var (
		changedCrons    []*model.Cron
		changedServices []*model.Service
		changedAlerts   []*model.AlertRule
		natIDs          []uint64
	)
	committed := false
	defer func() {
		if !committed {
			unblockDeletedServerUUIDs(addedBlocks)
		}
	}()

	err := DB.Transaction(func(tx *gorm.DB) error {
		tombstones := make([]model.ServerDeletionTombstone, 0, len(uuids))
		for _, uuid := range uuids {
			tombstones = append(tombstones, model.ServerDeletionTombstone{UUID: uuid})
		}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&tombstones).Error; err != nil {
			return err
		}

		var crons []*model.Cron
		if err := tx.Find(&crons).Error; err != nil {
			return err
		}
		for _, cron := range crons {
			next, changed := removeIDs(cron.Servers, deletedIDs)
			if !changed {
				continue
			}
			cron.Servers = next
			if err := tx.Save(cron).Error; err != nil {
				return err
			}
			changedCrons = append(changedCrons, cron)
		}

		var services []*model.Service
		if err := tx.Find(&services).Error; err != nil {
			return err
		}
		for _, service := range services {
			if !removeIDMap(service.SkipServers, deletedIDs) {
				continue
			}
			if err := tx.Save(service).Error; err != nil {
				return err
			}
			changedServices = append(changedServices, service)
		}

		var alerts []*model.AlertRule
		if err := tx.Find(&alerts).Error; err != nil {
			return err
		}
		for _, alert := range alerts {
			changed := false
			for _, rule := range alert.Rules {
				if rule != nil && removeIDMap(rule.Ignore, deletedIDs) {
					changed = true
				}
			}
			if !changed {
				continue
			}
			if err := tx.Save(alert).Error; err != nil {
				return err
			}
			changedAlerts = append(changedAlerts, alert)
		}

		var tokens []model.APIToken
		if err := tx.Find(&tokens).Error; err != nil {
			return err
		}
		for i := range tokens {
			next, changed := removeIDsFromCSV(tokens[i].ServersCSV, deletedIDs)
			if !changed {
				continue
			}
			if next == "" {
				// Empty means unrestricted, so deleting a token scoped only to
				// removed servers is safer than accidentally widening it.
				if err := tx.Unscoped().Delete(&model.APIToken{}, tokens[i].ID).Error; err != nil {
					return err
				}
				continue
			}
			if err := tx.Model(&tokens[i]).Update("servers_csv", next).Error; err != nil {
				return err
			}
		}

		if err := tx.Model(&model.NAT{}).Where("server_id IN ?", actualIDs).Pluck("id", &natIDs).Error; err != nil {
			return err
		}
		for _, target := range []any{
			&model.ServerGroupServer{},
			&model.Transfer{},
			&model.NAT{},
			&model.ServerTransfer{},
			&model.MCPAuditLog{},
		} {
			if err := tx.Unscoped().Delete(target, "server_id IN ?", actualIDs).Error; err != nil {
				return err
			}
		}
		if tx.Migrator().HasTable(&model.ServerSnapshot{}) {
			if err := tx.Unscoped().Delete(&model.ServerSnapshot{}, "server_id IN ?", actualIDs).Error; err != nil {
				return err
			}
		}
		if tx.Migrator().HasTable(&model.ServiceHistory{}) {
			if err := tx.Unscoped().Delete(&model.ServiceHistory{}, "server_id IN ?", actualIDs).Error; err != nil {
				return err
			}
		}

		if TSDBEnabled() {
			if err := TSDBShared.DeleteServerIDs(actualIDs); err != nil {
				return fmt.Errorf("delete TSDB server series: %w", err)
			}
		}
		return tx.Unscoped().Delete(&model.Server{}, "id IN ?", actualIDs).Error
	})
	if err != nil {
		return err
	}
	committed = true

	if ServerTransferShared != nil {
		ServerTransferShared.OnServersDeleted(actualIDs)
	}
	for _, id := range actualIDs {
		ServerTransferRevokeStreamsForServer(id)
	}
	ServerShared.Delete(actualIDs)
	if NATShared != nil && len(natIDs) > 0 {
		NATShared.Delete(natIDs)
	}
	for _, cron := range changedCrons {
		if err := CronShared.ReplaceAfterReferenceCleanup(cron); err != nil {
			log.Printf("NEZHA>> failed to refresh cron %d after server deletion: %v", cron.ID, err)
		}
	}
	for _, service := range changedServices {
		if err := ServiceSentinelShared.Update(service); err != nil {
			log.Printf("NEZHA>> failed to refresh service %d after server deletion: %v", service.ID, err)
		}
	}
	if len(changedServices) > 0 {
		ServiceSentinelShared.UpdateServiceList()
	}
	for _, alert := range changedAlerts {
		OnRefreshOrAddAlert(alert)
	}

	AlertsLock.Lock()
	for _, sid := range actualIDs {
		for _, alert := range Alerts {
			if AlertsCycleTransferStatsStore[alert.ID] != nil {
				delete(AlertsCycleTransferStatsStore[alert.ID].ServerName, sid)
				delete(AlertsCycleTransferStatsStore[alert.ID].Transfer, sid)
				delete(AlertsCycleTransferStatsStore[alert.ID].NextUpdate, sid)
			}
		}
	}
	AlertsLock.Unlock()

	return nil
}
