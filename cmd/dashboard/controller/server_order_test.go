package controller

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
)

func newServerRekeyTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared&_foreign_keys=on"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&model.Server{}, &model.ServerGroupServer{}, &model.Transfer{},
		&model.NAT{}, &model.ServerTransfer{}, &model.MCPAuditLog{},
		&model.ServiceHistory{}, &model.Cron{}, &model.Service{},
		&model.AlertRule{}, &model.APIToken{},
	))
	t.Cleanup(func() { singleton.DB = nil })
	singleton.DB = db
	return db
}

func seedServerRekeyRecords(t *testing.T, db *gorm.DB) {
	t.Helper()
	require.NoError(t, db.Create(&model.Server{
		Common: model.Common{ID: 47}, Name: "forty-seven", UUID: "00000000-0000-0000-0000-000000000047",
	}).Error)
	require.NoError(t, db.Create(&model.Server{
		Common: model.Common{ID: 63}, Name: "sixty-three", UUID: "00000000-0000-0000-0000-000000000063",
	}).Error)
	require.NoError(t, db.Create(&model.ServerGroupServer{ServerGroupId: 9, ServerId: 63}).Error)
	require.NoError(t, db.Create(&model.Transfer{ServerID: 47, In: 1}).Error)
	require.NoError(t, db.Create(&model.NAT{
		Common: model.Common{ID: 1}, Name: "nat", Domain: "nat.example", ServerID: 63,
	}).Error)
	require.NoError(t, db.Create(&model.ServerTransfer{
		Common: model.Common{ID: 1}, ServerID: 47,
	}).Error)
	require.NoError(t, db.Create(&model.MCPAuditLog{
		ID: 1, ServerID: 63, Tool: "server.get", Outcome: model.MCPOutcomeOK,
	}).Error)
	require.NoError(t, db.Create(&model.ServiceHistory{
		ID: 1, ServiceID: 3, ServerID: 47,
	}).Error)
	require.NoError(t, db.Create(&model.Cron{
		Common: model.Common{ID: 1}, Name: "cron", Servers: []uint64{63, 47},
	}).Error)
	require.NoError(t, db.Create(&model.Service{
		Common: model.Common{ID: 1}, Name: "svc", Type: model.TaskTypeHTTPGet,
		Target: "https://example.com", SkipServers: map[uint64]bool{47: true, 63: false},
	}).Error)
	enabled := true
	require.NoError(t, db.Create(&model.AlertRule{
		Common: model.Common{ID: 1}, Name: "alert", Enable: &enabled,
		Rules: []*model.Rule{{Type: "cpu", Duration: 3, Ignore: map[uint64]bool{63: true}}},
	}).Error)
	token := model.APIToken{ID: 1, UserID: 1, Name: "token", TokenHash: model.HashAPIToken("test-token")}
	token.SetServerIDs([]uint64{47, 63})
	require.NoError(t, db.Create(&token).Error)
}
func TestReassignServerIDsInDBUpdatesEveryReference(t *testing.T) {
	db := newServerRekeyTestDB(t)
	seedServerRekeyRecords(t, db)
	order := []uint64{63, 47}
	mapping := map[uint64]uint64{63: 1, 47: 2}

	require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
		return reassignServerIDsInDB(tx, order, mapping)
	}))

	var servers []model.Server
	require.NoError(t, db.Order("id").Find(&servers).Error)
	require.Equal(t, []uint64{1, 2}, []uint64{servers[0].ID, servers[1].ID})
	require.Equal(t, "sixty-three", servers[0].Name)
	require.Equal(t, "forty-seven", servers[1].Name)
	require.Equal(t, []int{2, 1}, []int{servers[0].DisplayIndex, servers[1].DisplayIndex})

	assertServerIDColumn(t, db, &model.ServerGroupServer{}, "server_id", 1)
	assertServerIDColumn(t, db, &model.Transfer{}, "server_id", 2)
	assertServerIDColumn(t, db, &model.NAT{}, "server_id", 1)
	assertServerIDColumn(t, db, &model.ServerTransfer{}, "server_id", 2)
	assertServerIDColumn(t, db, &model.MCPAuditLog{}, "server_id", 1)
	assertServerIDColumn(t, db, &model.ServiceHistory{}, "server_id", 2)
	var cron model.Cron
	require.NoError(t, db.First(&cron, 1).Error)
	require.Equal(t, []uint64{1, 2}, cron.Servers)

	var service model.Service
	require.NoError(t, db.First(&service, 1).Error)
	require.Equal(t, map[uint64]bool{2: true, 1: false}, service.SkipServers)

	var alert model.AlertRule
	require.NoError(t, db.First(&alert, 1).Error)
	require.True(t, alert.Rules[0].Ignore[1])
	require.NotContains(t, alert.Rules[0].Ignore, uint64(63))

	var token model.APIToken
	require.NoError(t, db.First(&token, 1).Error)
	require.Equal(t, []uint64{1, 2}, token.ServerIDs())

	created := model.Server{
		Name: "next", UUID: "00000000-0000-0000-0000-000000000003",
	}
	require.NoError(t, db.Create(&created).Error)
	require.Equal(t, uint64(3), created.ID)
}

func assertServerIDColumn(t *testing.T, db *gorm.DB, value any, column string, expected uint64) {
	t.Helper()
	var got uint64
	require.NoError(t, db.Model(value).Select(column).Scan(&got).Error)
	require.Equal(t, expected, got)
}

func TestReassignServerIDsInDBRollsBackAsOneTransaction(t *testing.T) {
	db := newServerRekeyTestDB(t)
	seedServerRekeyRecords(t, db)
	sentinel := errors.New("force rollback")

	err := db.Transaction(func(tx *gorm.DB) error {
		require.NoError(t, reassignServerIDsInDB(
			tx, []uint64{63, 47}, map[uint64]uint64{63: 1, 47: 2},
		))
		return sentinel
	})
	require.ErrorIs(t, err, sentinel)

	var ids []uint64
	require.NoError(t, db.Model(&model.Server{}).Order("id").Pluck("id", &ids).Error)
	require.Equal(t, []uint64{47, 63}, ids)
	assertServerIDColumn(t, db, &model.NAT{}, "server_id", 63)
}

func TestSnapshotFollowsSwappedIDsAndRollback(t *testing.T) {
	db := newServerRekeyTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.ServerSnapshot{}))
	for id, uuid := range map[uint64]string{1: "A", 2: "B"} {
		require.NoError(t, db.Create(&model.Server{Common: model.Common{ID: id}, UUID: uuid}).Error)
		require.NoError(t, singleton.PersistServerSnapshot(id, uuid, model.RecordedServerState{At: 100000, Host: &model.Host{Platform: uuid}, State: &model.HostState{CPU: float64(id)}}))
	}
	sentinel := errors.New("rollback snapshot swap")
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := reassignServerIDsInDB(tx, []uint64{2, 1}, map[uint64]uint64{1: 2, 2: 1}); err != nil {
			return err
		}
		return sentinel
	})
	require.ErrorIs(t, err, sentinel)
	before, err := singleton.QueryServerSnapshot(1, "A", 1)
	require.NoError(t, err)
	require.Equal(t, "A", before.Snapshot.Host.Platform)
	require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
		return reassignServerIDsInDB(tx, []uint64{2, 1}, map[uint64]uint64{1: 2, 2: 1})
	}))
	for id, uuid := range map[uint64]string{1: "B", 2: "A"} {
		got, err := singleton.QueryServerSnapshot(id, uuid, 1)
		require.NoError(t, err)
		require.Equal(t, uuid, got.Snapshot.Host.Platform)
	}
	require.NoError(t, singleton.PersistServerSnapshot(1, "A", model.RecordedServerState{At: 101000, State: &model.HostState{CPU: 99}}))
	got, err := singleton.QueryServerSnapshot(1, "B", 1)
	require.NoError(t, err)
	require.EqualValues(t, 100000, got.LastReportAt)
}
