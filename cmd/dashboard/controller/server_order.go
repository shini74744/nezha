package controller

import (
	"errors"
	"fmt"
	"os"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/goccy/go-json"
	"gorm.io/gorm"

	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
)

var (
	serverIDReassignMu sync.Mutex
	restartDashboard   = func() { os.Exit(0) }
)

type serverOrderForm struct {
	ServerIDs []uint64 `json:"server_ids" binding:"required"`
}

type serverIDReassignResult struct {
	Mapping      map[uint64]uint64 `json:"mapping"`
	Restarting   bool              `json:"restarting"`
	TSDBSnapshot string            `json:"tsdb_snapshot,omitempty"`
}

func validateCompleteServerOrder(tx *gorm.DB, order []uint64) error {
	if len(order) == 0 {
		return errors.New("server order cannot be empty")
	}
	seen := make(map[uint64]struct{}, len(order))
	for _, id := range order {
		if id == 0 {
			return errors.New("server id cannot be zero")
		}
		if _, ok := seen[id]; ok {
			return fmt.Errorf("duplicate server id %d", id)
		}
		seen[id] = struct{}{}
	}
	var existing []uint64
	if err := tx.Model(&model.Server{}).Pluck("id", &existing).Error; err != nil {
		return err
	}
	if len(existing) != len(order) {
		return fmt.Errorf("server order has %d entries, expected %d", len(order), len(existing))
	}
	for _, id := range existing {
		if _, ok := seen[id]; !ok {
			return fmt.Errorf("server order is missing id %d", id)
		}
	}
	return nil
}

func updateServerOrder(c *gin.Context) (any, error) {
	var form serverOrderForm
	if err := c.ShouldBindJSON(&form); err != nil {
		return nil, err
	}
	if err := singleton.DB.Transaction(func(tx *gorm.DB) error {
		if err := validateCompleteServerOrder(tx, form.ServerIDs); err != nil {
			return err
		}
		for index, id := range form.ServerIDs {
			displayIndex := len(form.ServerIDs) - index
			if err := tx.Model(&model.Server{}).Where("id = ?", id).
				Update("display_index", displayIndex).Error; err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return nil, newGormError("%v", err)
	}
	for _, id := range form.ServerIDs {
		var server model.Server
		if err := singleton.DB.First(&server, id).Error; err != nil {
			return nil, err
		}
		if running, ok := singleton.ServerShared.Get(id); ok {
			server.CopyFromRunningServer(running)
		}
		singleton.ServerShared.Update(&server, "")
	}
	return nil, nil
}

func reassignServerIDs(c *gin.Context) (*serverIDReassignResult, error) {
	var form serverOrderForm
	if err := c.ShouldBindJSON(&form); err != nil {
		return nil, err
	}
	serverIDReassignMu.Lock()
	defer serverIDReassignMu.Unlock()
	if err := validateCompleteServerOrder(singleton.DB, form.ServerIDs); err != nil {
		return nil, err
	}
	mapping := make(map[uint64]uint64, len(form.ServerIDs))
	changed := false
	for index, oldID := range form.ServerIDs {
		newID := uint64(index + 1)
		mapping[oldID] = newID
		changed = changed || oldID != newID
	}
	if !changed {
		return &serverIDReassignResult{Mapping: mapping}, nil
	}

	singleton.ServerIDReassignmentInProgress.Store(true)
	success := false
	defer func() {
		if !success {
			singleton.ServerIDReassignmentInProgress.Store(false)
		}
	}()

	var tsdbSnapshot string
	if singleton.TSDBEnabled() {
		if err := singleton.TSDBShared.PauseWritesForMaintenance(); err != nil {
			return nil, err
		}
		var err error
		tsdbSnapshot, err = singleton.TSDBShared.CreateMaintenanceSnapshot()
		if err != nil {
			singleton.TSDBShared.ResumeWritesAfterMaintenance()
			return nil, err
		}
		if err := singleton.TSDBShared.RemapServerIDs(mapping); err != nil {
			singleton.TSDBShared.ResumeWritesAfterMaintenance()
			return nil, err
		}
	}
	oldIgnored := singleton.Conf.IgnoredIPNotification
	singleton.Conf.IgnoredIPNotification = remapServerIDCSV(oldIgnored, mapping)
	if err := singleton.Conf.Save(); err != nil {
		rollbackTSDBServerIDs(mapping)
		singleton.Conf.IgnoredIPNotification = oldIgnored
		return nil, err
	}

	if err := singleton.DB.Transaction(func(tx *gorm.DB) error {
		return reassignServerIDsInDB(tx, form.ServerIDs, mapping)
	}); err != nil {
		singleton.Conf.IgnoredIPNotification = oldIgnored
		_ = singleton.Conf.Save()
		rollbackTSDBServerIDs(mapping)
		return nil, newGormError("%v", err)
	}

	success = true
	go func() {
		time.Sleep(500 * time.Millisecond)
		restartDashboard()
	}()
	return &serverIDReassignResult{
		Mapping: mapping, Restarting: true, TSDBSnapshot: tsdbSnapshot,
	}, nil
}

func rollbackTSDBServerIDs(mapping map[uint64]uint64) {
	if !singleton.TSDBEnabled() {
		return
	}
	inverse := make(map[uint64]uint64, len(mapping))
	for oldID, newID := range mapping {
		inverse[newID] = oldID
	}
	if err := singleton.TSDBShared.RemapServerIDs(inverse); err != nil {
		return
	}
	singleton.TSDBShared.ResumeWritesAfterMaintenance()
}
func reassignServerIDsInDB(tx *gorm.DB, order []uint64, mapping map[uint64]uint64) error {
	if err := validateCompleteServerOrder(tx, order); err != nil {
		return err
	}
	// Production uses SQLite. Defer foreign-key checks until commit because the
	// two-phase primary-key move is temporarily inconsistent by design.
	if tx.Dialector.Name() == "sqlite" {
		if err := tx.Exec("PRAGMA defer_foreign_keys = ON").Error; err != nil {
			return err
		}
	}
	if err := remapEmbeddedServerIDs(tx, mapping); err != nil {
		return err
	}

	var maxID uint64
	if err := tx.Model(&model.Server{}).Select("COALESCE(MAX(id), 0)").Scan(&maxID).Error; err != nil {
		return err
	}
	temporary := make(map[uint64]uint64, len(mapping))
	tempBase := maxID + uint64(len(mapping)) + 1024
	for index, oldID := range order {
		temporary[oldID] = tempBase + uint64(index)
	}
	for _, ref := range serverIDReferences(tx) {
		if err := moveServerIDColumn(tx, ref[0], ref[1], temporary); err != nil {
			return err
		}
	}
	for _, ref := range serverIDReferences(tx) {
		tempToFinal := make(map[uint64]uint64, len(mapping))
		for oldID, tempID := range temporary {
			tempToFinal[tempID] = mapping[oldID]
		}
		if err := moveServerIDColumn(tx, ref[0], ref[1], tempToFinal); err != nil {
			return err
		}
	}
	for index := range order {
		newID := uint64(index + 1)
		displayIndex := len(order) - index
		if err := tx.Model(&model.Server{}).Where("id = ?", newID).
			Update("display_index", displayIndex).Error; err != nil {
			return err
		}
	}
	if tx.Migrator().HasTable("sqlite_sequence") {
		if err := tx.Exec("UPDATE sqlite_sequence SET seq = ? WHERE name = 'servers'", len(order)).Error; err != nil {
			return err
		}
	}
	return nil
}

func serverIDReferences(tx *gorm.DB) [][2]string {
	refs := [][2]string{{"servers", "id"}}
	for _, ref := range [][2]string{
		{"server_group_servers", "server_id"},
		{"transfers", "server_id"},
		{"nats", "server_id"},
		{"server_transfers", "server_id"},
		{"mcp_audit_logs", "server_id"},
		{"service_histories", "server_id"},
		{"server_snapshots", "server_id"},
	} {
		if tx.Migrator().HasTable(ref[0]) && tx.Migrator().HasColumn(ref[0], ref[1]) {
			refs = append(refs, ref)
		}
	}
	return refs
}
func moveServerIDColumn(tx *gorm.DB, table, column string, mapping map[uint64]uint64) error {
	for from, to := range mapping {
		query := fmt.Sprintf("UPDATE %s SET %s = ? WHERE %s = ?", table, column, column)
		if err := tx.Exec(query, to, from).Error; err != nil {
			return fmt.Errorf("update %s.%s from %d to %d: %w", table, column, from, to, err)
		}
	}
	return nil
}

func remapEmbeddedServerIDs(tx *gorm.DB, mapping map[uint64]uint64) error {
	if err := remapCronServerIDs(tx, mapping); err != nil {
		return err
	}
	if err := remapServiceServerIDs(tx, mapping); err != nil {
		return err
	}
	if err := remapAlertServerIDs(tx, mapping); err != nil {
		return err
	}
	return remapAPITokenServerIDs(tx, mapping)
}

func remapCronServerIDs(tx *gorm.DB, mapping map[uint64]uint64) error {
	var rows []model.Cron
	if err := tx.Find(&rows).Error; err != nil {
		return err
	}
	for i := range rows {
		for j, id := range rows[i].Servers {
			if next, ok := mapping[id]; ok {
				rows[i].Servers[j] = next
			}
		}
		raw, err := json.Marshal(rows[i].Servers)
		if err != nil {
			return err
		}
		if err := tx.Model(&rows[i]).UpdateColumn("servers_raw", string(raw)).Error; err != nil {
			return err
		}
	}
	return nil
}
func remapServiceServerIDs(tx *gorm.DB, mapping map[uint64]uint64) error {
	var rows []model.Service
	if err := tx.Find(&rows).Error; err != nil {
		return err
	}
	for i := range rows {
		next := make(map[uint64]bool, len(rows[i].SkipServers))
		for id, value := range rows[i].SkipServers {
			if replacement, ok := mapping[id]; ok {
				id = replacement
			}
			next[id] = value
		}
		raw, err := json.Marshal(next)
		if err != nil {
			return err
		}
		if err := tx.Model(&rows[i]).UpdateColumn("skip_servers_raw", string(raw)).Error; err != nil {
			return err
		}
	}
	return nil
}

func remapAlertServerIDs(tx *gorm.DB, mapping map[uint64]uint64) error {
	var rows []model.AlertRule
	if err := tx.Find(&rows).Error; err != nil {
		return err
	}
	for i := range rows {
		for _, rule := range rows[i].Rules {
			if rule == nil {
				continue
			}
			next := make(map[uint64]bool, len(rule.Ignore))
			for id, value := range rule.Ignore {
				if replacement, ok := mapping[id]; ok {
					id = replacement
				}
				next[id] = value
			}
			rule.Ignore = next
		}
		raw, err := json.Marshal(rows[i].Rules)
		if err != nil {
			return err
		}
		if err := tx.Model(&rows[i]).UpdateColumn("rules_raw", string(raw)).Error; err != nil {
			return err
		}
	}
	return nil
}

func remapAPITokenServerIDs(tx *gorm.DB, mapping map[uint64]uint64) error {
	var rows []model.APIToken
	if err := tx.Find(&rows).Error; err != nil {
		return err
	}
	for i := range rows {
		ids := rows[i].ServerIDs()
		for j, id := range ids {
			if next, ok := mapping[id]; ok {
				ids[j] = next
			}
		}
		slices.Sort(ids)
		ids = slices.Compact(ids)
		rows[i].SetServerIDs(ids)
		if err := tx.Model(&rows[i]).UpdateColumn("servers_csv", rows[i].ServersCSV).Error; err != nil {
			return err
		}
	}
	return nil
}

func remapServerIDCSV(raw string, mapping map[uint64]uint64) string {
	if strings.TrimSpace(raw) == "" {
		return raw
	}
	parts := strings.Split(raw, ",")
	for i, part := range parts {
		id, err := strconv.ParseUint(strings.TrimSpace(part), 10, 64)
		if err == nil {
			if next, ok := mapping[id]; ok {
				parts[i] = strconv.FormatUint(next, 10)
			}
		}
	}
	return strings.Join(parts, ",")
}
