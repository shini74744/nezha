package model

import (
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"testing"
)

func TestInventoryHistoryPermanentBaselineAndChanges(t *testing.T) {
	db := operationTestDB(t)
	require.NoError(t, db.AutoMigrate(&ServerInventoryBaseline{}))
	s := &Server{Common: Common{ID: 9, UserID: 1}, UUID: "history-node", Name: "old"}
	require.NoError(t, db.Create(s).Error)
	host := &Host{CPU: []string{"cpu-a"}, MemTotal: 1024, DiskTotal: 4096, Platform: "debian", PlatformVersion: "12"}
	record := func(values map[string]string) {
		require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return RecordServerInventory(tx, s, values) }))
	}
	record(HostInventoryValues(host))
	record(HostInventoryValues(host))
	var count int64
	require.NoError(t, db.Model(&ServerOperationLog{}).Count(&count).Error)
	require.EqualValues(t, 1, count)
	host.Platform, host.PlatformVersion, host.MemTotal, host.CPU = "ubuntu", "24.04", 2048, []string{"cpu-b"}
	record(HostInventoryValues(host))
	var last ServerOperationLog
	require.NoError(t, db.Last(&last).Error)
	require.Equal(t, "inventory_change", last.Action)
	require.Contains(t, last.Changes, ServerOperationChange{"operating_system", "debian 12", "ubuntu 24.04"})
	require.Contains(t, last.Changes, ServerOperationChange{"memory_total", "1024", "2048"})
	for i := 0; i < 12; i++ {
		record(map[string]string{"ipv4": string(rune('a' + i)), "region": "MY"})
	}
	require.NoError(t, db.Model(&ServerOperationLog{}).Count(&count).Error)
	require.EqualValues(t, 14, count)
	// Deleting the live node does not cascade into independent history.
	require.NoError(t, db.Delete(s).Error)
	require.NoError(t, db.Model(&ServerOperationLog{}).Count(&count).Error)
	require.EqualValues(t, 14, count)
	// Manual history deletion does not recreate unchanged reports.
	require.NoError(t, db.Where("server_uuid = ?", s.UUID).Delete(&ServerOperationLog{}).Error)
	record(HostInventoryValues(host))
	require.NoError(t, db.Model(&ServerOperationLog{}).Count(&count).Error)
	require.Zero(t, count)
}
func TestInventoryHistoryWriteFailureDoesNotAdvanceBaseline(t *testing.T) {
	db := operationTestDB(t)
	require.NoError(t, db.AutoMigrate(&ServerInventoryBaseline{}))
	s := &Server{UUID: "retry"}
	require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return RecordServerInventory(tx, s, map[string]string{"cpu": "a"}) }))
	require.NoError(t, db.Migrator().DropTable(&ServerOperationLog{}))
	require.Error(t, db.Transaction(func(tx *gorm.DB) error { return RecordServerInventory(tx, s, map[string]string{"cpu": "b"}) }))
	var baseline ServerInventoryBaseline
	require.NoError(t, db.First(&baseline).Error)
	require.Equal(t, "a", baseline.Values["cpu"])
}
