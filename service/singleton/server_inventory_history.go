package singleton

import (
	"github.com/nezhahq/nezha/model"
	"gorm.io/gorm"
	"time"
)

// Serialize against deletion/reassignment and other inventory reports. Resolve
// the canonical persisted identity so a late report cannot attach to a reused ID.
func RecordServerInventory(id uint64, uuid string, values map[string]string, generation ...uint64) error {
	if DB == nil || uuid == "" || len(values) == 0 {
		return nil
	}
	ServerMutationMu.Lock()
	defer ServerMutationMu.Unlock()
	return retryIPHistoryWrite(func() error {
		return DB.Transaction(func(tx *gorm.DB) error {
			var server model.Server
			query := tx.Where("id = ? AND uuid = ?", id, uuid)
			if len(generation) > 0 {
				query = query.Where("machine_generation = ?", generation[0])
			}
			if err := query.First(&server).Error; err != nil {
				return err
			}
			return model.RecordServerInventory(tx, &server, values)
		})
	})
}

func ApplyAgentHostReport(server *model.Server, host *model.Host) (model.HostReportResult, error) {
	ServerMutationMu.Lock()
	defer ServerMutationMu.Unlock()
	var current model.Server
	if err := DB.Where("id = ? AND uuid = ? AND machine_generation = ?", server.ID, server.UUID, server.MachineGeneration).First(&current).Error; err != nil {
		return model.HostReportResult{}, err
	}
	result, err := server.RuntimeHandle().RefreshHostReport(host, time.Now(), PersistTransfer)
	if err != nil || !result.Applied {
		return result, err
	}
	err = retryIPHistoryWrite(func() error {
		return DB.Transaction(func(tx *gorm.DB) error {
			return model.RecordServerInventory(tx, &current, model.HostInventoryValues(host))
		})
	})
	return result, err
}
