package singleton

import (
	"errors"
	"fmt"
	"github.com/nezhahq/nezha/model"
	"gorm.io/gorm"
	"strings"
	"time"
)

// RecordServerIPChange keeps at most seven old address pairs, newest first.
// The baseline and changes survive restarts. No record is written for duplicate reports.
func RecordServerIPChange(server *model.Server, next model.IP, at time.Time) (old model.IP, history []model.ServerIPHistoryEntry, changed bool, err error) {
	if next.Join() == "" {
		return
	}
	if server.UUID == "" {
		err = fmt.Errorf("server UUID missing")
		return
	}
	ServerMutationMu.Lock()
	defer ServerMutationMu.Unlock()
	err = retryIPHistoryWrite(func() error {
		return DB.Transaction(func(tx *gorm.DB) error {
			old = model.IP{}
			history = nil
			changed = false
			var count int64
			if e := tx.Model(&model.Server{}).Where("id = ? AND uuid = ?", server.ID, server.UUID).Count(&count).Error; e != nil {
				return e
			}
			if count != 1 {
				return gorm.ErrRecordNotFound
			}
			var row model.ServerIPHistory
			e := tx.Where("server_uuid = ?", server.UUID).First(&row).Error
			missing := errors.Is(e, gorm.ErrRecordNotFound)
			if missing {
				row.ServerUUID = server.UUID
				// Runtime fallback covers first use without requiring a restart.
				if server.GeoIP != nil {
					row.CurrentIP = server.GeoIP.IP
				}
			} else if e != nil {
				return e
			}
			old = row.CurrentIP
			history = row.History
			if old == next && !missing {
				return nil
			}
			changed = old.Join() != "" && old != next
			if changed {
				history = append([]model.ServerIPHistoryEntry{{IP: old, ChangedAt: at}}, history...)
				if len(history) > 7 {
					history = history[:7]
				}
			}
			row.CurrentIP = next
			row.History = history
			return tx.Save(&row).Error
		})
	})
	if err != nil {
		changed = false
		history = nil
	}
	return
}
func ReadServerIPHistory(uuid string) ([]model.ServerIPHistoryEntry, error) {
	var row model.ServerIPHistory
	err := DB.Where("server_uuid = ?", uuid).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return row.History, err
}
func FormatIPHistory(history []model.ServerIPHistoryEntry) string {
	if len(history) == 0 {
		return "暂无记录"
	}
	loc := Loc
	if loc == nil {
		loc = time.Local
	}
	lines := make([]string, 0, 7)
	for i, entry := range history {
		if i == 7 {
			break
		}
		lines = append(lines, fmt.Sprintf("%d. %s  %s", i+1, IPDesensitize(entry.IP.Join()), entry.ChangedAt.In(loc).Format("2006-01-02 15:04:05 -0700")))
	}
	return strings.Join(lines, "\n")
}

func retryIPHistoryWrite(write func() error) error {
	var err error
	for attempt := 0; attempt < 8; attempt++ {
		err = write()
		if err == nil {
			return nil
		}
		message := strings.ToLower(err.Error())
		if !strings.Contains(message, "database is locked") && !strings.Contains(message, "database table is locked") && !strings.Contains(message, "sqlite_busy") {
			return err
		}
		// Roll back the whole transaction before retrying, releasing its read snapshot.
		if attempt < 7 {
			time.Sleep(time.Duration(10<<attempt) * time.Millisecond)
		}
	}
	return err
}
