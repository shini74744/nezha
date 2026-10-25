package singleton

import (
	"github.com/nezhahq/nezha/model"
	"gorm.io/gorm/clause"
	"time"
)

func InitOnlineHistoryCoverage() error {
	return DB.Exec("INSERT OR IGNORE INTO online_history_coverages (server_id, started_at) SELECT id, ? FROM servers", time.Now().UTC()).Error
}
func ensureOnlineHistoryCoverage(id uint64, at time.Time) error {
	return DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.OnlineHistoryCoverage{ServerID: id, StartedAt: at.UTC()}).Error
}

// Call after setting the reassignment gate and before remapping database IDs.
// Writers recheck the gate while holding this mutex.
func DrainOnlineHistory() {
	if r := OnlineHistoryShared; r != nil {
		r.mu.Lock()
		r.mu.Unlock()
	}
}
func (r *OnlineHistoryRecorder) Forget(ids []uint64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, id := range ids {
		delete(r.open, id)
		delete(r.closing, id)
		delete(r.recoveryDisconnects, id)
	}
}
