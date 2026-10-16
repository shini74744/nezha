package model

import (
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"strings"
	"testing"
)

func TestInventoryDualStackEventSnapshots(t *testing.T) {
	db := operationTestDB(t)
	require.NoError(t, db.AutoMigrate(&ServerInventoryBaseline{}))
	s := &Server{UUID: "dual-stack"}
	record := func(v4, v6 string) {
		require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
			return RecordServerInventory(tx, s, GeoInventoryValues(&GeoIP{IP: IP{IPv4Addr: v4, IPv6Addr: v6}}))
		}))
	}
	last := func() ServerOperationLog {
		var row ServerOperationLog
		require.NoError(t, db.Last(&row).Error)
		return row
	}
	v6 := "2001:db8::1"
	record("192.0.2.1", v6)
	require.Len(t, last().Changes, 2)
	require.Equal(t, []ServerOperationIPSnapshot{
		{Field: "ipv4", Before: "未记录", After: "192.0.2.1", Observed: true},
		{Field: "ipv6", Before: "未记录", After: v6, Observed: true},
	}, last().Details.IPSnapshot)
	record("192.0.2.2", v6)
	row := last()
	require.Equal(t, []ServerOperationChange{{"ipv4", "192.0.2.1", "192.0.2.2"}}, row.Changes)
	require.Equal(t, ServerOperationIPSnapshot{"ipv6", v6, v6, true}, row.Details.IPSnapshot[1])
	// A failed lookup is not a change, nor proof of an unchanged live address.
	record("", v6)
	require.Equal(t, row.ID, last().ID)
	record("192.0.2.3", "")
	require.Equal(t, ServerOperationIPSnapshot{"ipv6", v6, v6, false}, last().Details.IPSnapshot[1])
	record("192.0.2.3", v6)
	require.Len(t, last().Changes, 1)
	// IPv6-only change retains the event-time IPv4; later reports cannot alter it.
	record("192.0.2.3", "2001:db8::2")
	require.Equal(t, ServerOperationIPSnapshot{"ipv4", "192.0.2.3", "192.0.2.3", true}, last().Details.IPSnapshot[0])
	record("192.0.2.4", "2001:db8::3")
	require.Len(t, last().Changes, 2)
	var earlier ServerOperationLog
	require.NoError(t, db.First(&earlier, row.ID).Error)
	require.Equal(t, row.Details, earlier.Details)
	// A different UUID has its own baseline, even when the numeric ID is reused.
	s.UUID = "single-stack"
	record("198.51.100.1", "")
	require.Equal(t, ServerOperationIPSnapshot{"ipv6", "未记录", "未记录", false}, last().Details.IPSnapshot[1])
	record("", "")
	require.Len(t, last().Changes, 1)
	require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
		return RecordServerInventory(tx, s, map[string]string{"cpu": "new"})
	}))
	require.Nil(t, last().Details)
}

func TestPublicNoteSnapshotExactLongContentAndEmpty(t *testing.T) {
	db := operationTestDB(t)
	old := strings.Repeat("公开备注", 900) + "\n<before>"
	next := strings.Repeat("公开备注", 900) + "\n<after>"
	s := &Server{Common: Common{ID: 9}, UUID: "public-note", PublicNote: old, Note: "private-password"}
	require.NoError(t, db.Create(s).Error)
	require.NoError(t, WithServerOperation(db, ServerOperationActor{}, "edit", []uint64{9}, func(tx *gorm.DB) error {
		return tx.Model(&Server{}).Where("id = ?", 9).Update("public_note", next).Error
	}))
	var row ServerOperationLog
	require.NoError(t, db.Last(&row).Error)
	require.Equal(t, old, row.Details.PublicNote.Before)
	require.Equal(t, next, row.Details.PublicNote.After)
	require.Len(t, row.Changes, 1)
	// Snapshot and edit remain atomic when a public note is cleared.
	require.NoError(t, WithServerOperation(db, ServerOperationActor{}, "edit", []uint64{9}, func(tx *gorm.DB) error {
		return tx.Model(&Server{}).Where("id = ?", 9).Update("public_note", "").Error
	}))
	row = ServerOperationLog{}
	require.NoError(t, db.Last(&row).Error)
	require.Equal(t, &ServerOperationTextSnapshot{Before: next, After: ""}, row.Details.PublicNote)
	require.Equal(t, []ServerOperationChange{{"public_note", "已设置", "未设置"}}, row.Changes)
	require.Nil(t, publicNoteOperationDetails(s, nil))
	require.Equal(t, old, publicNoteOperationDetails(nil, s).PublicNote.After)
}

func TestOperationDetailsMigrationPreservesLegacyRows(t *testing.T) {
	db := operationTestDB(t)
	require.NoError(t, db.Migrator().DropColumn(&ServerOperationLog{}, "Details"))
	require.NoError(t, db.Exec("INSERT INTO server_operation_logs (server_uuid,action,changes) VALUES (?,?,?)",
		"legacy", "edit", `[{"field":"public_note","before":"已设置（内容不记录）","after":"已设置（内容不记录）"}]`).Error)
	require.NoError(t, db.AutoMigrate(&ServerOperationLog{}))
	var row ServerOperationLog
	require.NoError(t, db.First(&row).Error)
	require.Nil(t, row.Details)
	require.Equal(t, "已设置（内容不记录）", row.Changes[0].Before)
}
