package singleton

import (
	"errors"
	"github.com/nezhahq/nezha/model"
	"gorm.io/gorm"
	"time"
)

// Controller-owned detection stores participate in the identity-guarded SQLite
// transaction. Full-reset tickets also erase node configuration and history.
var ReplacementDataCleanupHook func(*gorm.DB, *model.Server) (func(), error)

// Excludes controller-owned terminal mutations while reset removes their history.
var ReplacementQuiesceHook func(*model.Server) func()

// The controller serializes this file-backed setting with other settings edits.
var ReplacementConfigResetHook = ResetReplacementIPNotification

func CompleteServerReplacement(secret, uuid string, host *model.Host, state *model.HostState) (*model.Server, error) {
	if host == nil || state == nil || host.Platform == "" || state.NetInTransfer > 1<<63-1 || state.NetOutTransfer > 1<<63-1 || state.Uptime > 100*366*86400 {
		return nil, errors.New("换机需要同一换机凭据的完整主机及状态上报")
	}
	ServerMutationMu.Lock()
	defer ServerMutationMu.Unlock()
	row, current, err := AuthorizeServerReplacement(secret, uuid)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, errors.New("换机凭据缺失")
	}
	if row.State == "active" {
		return current, nil
	}
	if ServerIDReassignmentInProgress.Load() {
		return nil, errors.New("服务器 ID 正在调整")
	}
	if ServerTransferShared != nil {
		if _, ok := ServerTransferShared.LookupPending(current.ID); ok {
			return nil, errors.New("服务器归属正在转移")
		}
	}
	// Journal admission before touching either storage backend. Retry incomplete
	// cleanup on this credential, including after a dashboard restart.
	if err = DB.Model(row).Update("state", "clearing").Error; err != nil {
		return nil, err
	}
	replacementClearing.Store(uuid, true)
	fullReset := row.ResetScope == FullNodeReplacementScope
	// Do not let an in-flight expiry worker restore an old delivery record.
	serverExpiryMu.Lock()
	defer serverExpiryMu.Unlock()
	if fullReset {
		if err := ReplacementConfigResetHook(current.ID); err != nil {
			return nil, err
		}
	}
	if fullReset && ReplacementQuiesceHook != nil {
		resume := ReplacementQuiesceHook(current)
		defer resume()
	}
	ServerShared.lockLifecycleWrite()
	defer ServerShared.unlockLifecycleWrite()
	current.RetireMachineRuntime()
	ServerTransferRevokeStreamsForServer(current.ID)
	var fresh model.Server
	var resetCaches, resetReferences func()
	var adopted *model.AgentCredential
	now := time.Now()
	err = DB.Transaction(func(tx *gorm.DB) error {
		if e := tx.Where("id = ? AND uuid = ? AND user_id = ?", current.ID, uuid, row.OwnerID).First(&fresh).Error; e != nil {
			return e
		}
		for _, target := range []any{&model.Transfer{}, &model.ServerSnapshot{}, &model.ServiceHistory{}} {
			// ServiceHistory is a legacy SQLite table; new installs use TSDB only.
			if !tx.Migrator().HasTable(target) {
				continue
			}
			if e := tx.Where("server_id = ?", current.ID).Delete(target).Error; e != nil {
				return e
			}
		}
		if ReplacementDataCleanupHook != nil {
			var e error
			resetCaches, e = ReplacementDataCleanupHook(tx, &fresh)
			if e != nil {
				return e
			}
		}
		if e := tx.Where("server_uuid = ?", uuid).Delete(&model.ServerIPHistory{}).Error; e != nil {
			return e
		}
		if tx.Migrator().HasTable(&model.ServerNICNotice{}) {
			if e := tx.Where("uuid = ?", uuid).Delete(&model.ServerNICNotice{}).Error; e != nil {
				return e
			}
		}
		if e := tx.Where("uuid = ?", uuid).Delete(&model.PlanTrafficDay{}).Error; e != nil {
			return e
		}
		if e := tx.Where("uuid = ?", uuid).Delete(&model.PlanTrafficCheckpoint{}).Error; e != nil {
			return e
		}
		if e := tx.Where("uuid = ?", uuid).Delete(&model.AgentUUIDConflict{}).Error; e != nil {
			return e
		}
		if fullReset {
			var e error
			resetReferences, e = resetReplacementNode(tx, &fresh, row.CreatedAt)
			if e != nil {
				return e
			}
			if e = seedReplacementInventory(tx, &fresh, host); e != nil {
				return e
			}
		} else {
			// Resume already-clearing legacy tickets under their original narrow
			// scope; deployment must not expand previously granted deletion rights.
			fresh.MachineGeneration++
			if e := tx.Model(&model.Server{}).Where("id = ? AND uuid = ?", fresh.ID, uuid).Update("machine_generation", fresh.MachineGeneration).Error; e != nil {
				return e
			}
			if e := model.RecordServerInventory(tx, &fresh, model.HostInventoryValues(host)); e != nil {
				return e
			}
			if e := model.RecordServerOperationChanges(tx, model.ServerOperationActor{ID: row.ActorID, Name: row.ActorName, Source: "web"}, "replace_machine", &fresh, fresh.ID,
				[]model.ServerOperationChange{{Field: "replacement", Before: "旧机器监控及流量数据", After: "新机器首次上报成功；监控已清理，流量从新基准计数；变更历史保留"}}); e != nil {
				return e
			}
		}
		if TSDBEnabled() {
			if e := TSDBShared.DeleteServerIDs([]uint64{fresh.ID}); e != nil {
				return e
			}
		}
		if e := tx.Where("server_uuid = ? AND id <> ?", uuid, row.ID).Delete(&model.ServerReplacement{}).Error; e != nil {
			return e
		}
		var adoptionErr error
		adopted, adoptionErr = adoptAgentCredentialInTx(tx, &fresh, uuid, secret)
		if adoptionErr != nil {
			return adoptionErr
		}
		return tx.Model(row).Updates(map[string]any{"state": "active", "completed_at": now}).Error
	})
	if err != nil {
		return nil, err
	}
	if adopted != nil {
		publishAgentCredential(*adopted)
	}
	model.InitServer(&fresh)
	if _, err = fresh.RuntimeHandle().RefreshHostReport(host, now, nil); err != nil {
		return nil, err
	}
	ForgetNICSelectionNotice(uuid)
	fresh.SetTransferSnapshots(state.NetInTransfer, state.NetOutTransfer)
	if resetCaches != nil {
		resetCaches()
	}
	if resetReferences != nil {
		resetReferences()
	}
	if ServiceSentinelShared != nil {
		ServiceSentinelShared.forgetReplacedServer(current.ID)
	}
	AlertsLock.Lock()
	for _, stats := range AlertsCycleTransferStatsStore {
		if stats != nil {
			delete(stats.ServerName, current.ID)
			delete(stats.Transfer, current.ID)
			delete(stats.NextUpdate, current.ID)
		}
	}
	AlertsLock.Unlock()
	ServerShared.listMu.Lock()
	ServerShared.list[fresh.ID] = &fresh
	ServerShared.listMu.Unlock()
	ServerShared.sortList()
	replacementClearing.Delete(uuid)
	return &fresh, nil
}

func (ss *ServiceSentinel) forgetReplacedServer(id uint64) {
	ss.serviceResponseDataStoreLock.Lock()
	defer ss.serviceResponseDataStoreLock.Unlock()
	for _, byServer := range ss.serviceResponsePing {
		delete(byServer, id)
	}
}
