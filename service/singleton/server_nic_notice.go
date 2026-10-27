package singleton

import (
	"errors"
	"github.com/nezhahq/nezha/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"sync"
)

var nicNoticeReports = struct {
	sync.Mutex
	db   *gorm.DB
	last map[string]string
}{}

// PersistNICSelectionNotice is called only for an accepted state stream.
// Identical reports never re-arm an acknowledged reminder, including restart.
func PersistNICSelectionNotice(uuid, eventID string) error {
	if eventID == "" {
		return nil
	}
	if uuid == "" || len(eventID) > 64 {
		return errors.New("invalid NIC reminder")
	}
	nicNoticeReports.Lock()
	defer nicNoticeReports.Unlock()
	if DB == nil {
		return errors.New("database unavailable")
	}
	if nicNoticeReports.db != DB {
		nicNoticeReports.db = DB
		nicNoticeReports.last = make(map[string]string)
	}
	if nicNoticeReports.last[uuid] == eventID {
		return nil
	}
	row := model.ServerNICNotice{UUID: uuid, EventID: eventID, Unread: true}
	err := DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "uuid"}},
		DoUpdates: clause.Assignments(map[string]any{"event_id": eventID, "unread": true}),
		Where: clause.Where{Exprs: []clause.Expression{
			clause.Neq{Column: clause.Column{Table: "server_nic_notices", Name: "event_id"}, Value: eventID},
		}},
	}).Create(&row).Error
	if err == nil {
		nicNoticeReports.last[uuid] = eventID
	}
	return err
}

func ForgetNICSelectionNotice(uuid string) {
	nicNoticeReports.Lock()
	delete(nicNoticeReports.last, uuid)
	nicNoticeReports.Unlock()
}

// A delayed acknowledgement must not clear a newer reminder.
func AcknowledgeNICSelectionNotice(uuid, eventID string) (bool, error) {
	if uuid == "" || eventID == "" || len(eventID) > 64 {
		return false, errors.New("invalid NIC reminder")
	}
	result := DB.Model(&model.ServerNICNotice{}).
		Where("uuid = ? AND event_id = ? AND unread = ?", uuid, eventID, true).
		Update("unread", false)
	return result.RowsAffected > 0, result.Error
}
