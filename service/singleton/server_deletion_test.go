package singleton

import (
	"fmt"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/nezhahq/nezha/model"
)

func setupPermanentDeleteTest(t *testing.T) {
	t.Helper()

	previousDB := DB
	previousServers := ServerShared
	previousNAT := NATShared
	previousTransfers := ServerTransferShared
	previousTSDB := TSDBShared
	previousAlerts := Alerts
	previousCycleStore := AlertsCycleTransferStatsStore

	var err error
	DB, err = gorm.Open(openSQLiteDialector(filepath.Join(t.TempDir(), "dashboard.sqlite")), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := DB.DB()
	require.NoError(t, err)
	require.NoError(t, DB.AutoMigrate(
		&model.Server{},
		&model.ServerDeletionTombstone{},
		&model.ServerGroupServer{},
		&model.Transfer{},
		&model.NAT{},
		&model.ServerTransfer{},
		&model.MCPAuditLog{},
		&model.Cron{},
		&model.Service{},
		&model.AlertRule{},
		&model.APIToken{},
	))
	require.NoError(t, initDeletedServerUUIDs())
	ServerShared = NewServerClass()
	NATShared = NewNATClass()
	ServerTransferShared = nil
	TSDBShared = nil
	Alerts = nil
	AlertsCycleTransferStatsStore = make(map[uint64]*model.CycleTransferStats)

	t.Cleanup(func() {
		DB = previousDB
		ServerShared = previousServers
		NATShared = previousNAT
		ServerTransferShared = previousTransfers
		TSDBShared = previousTSDB
		Alerts = previousAlerts
		AlertsCycleTransferStatsStore = previousCycleStore
		deletedServerUUIDs.Lock()
		deletedServerUUIDs.values = make(map[string]struct{})
		deletedServerUUIDs.Unlock()
		require.NoError(t, sqlDB.Close())
	})
}

func TestCreateServerWithLowestAvailableIDReusesDeletedGap(t *testing.T) {
	setupPermanentDeleteTest(t)

	for id := uint64(1); id <= 12; id++ {
		if id == 11 {
			continue
		}
		require.NoError(t, DB.Create(&model.Server{
			Common: model.Common{ID: id, UserID: 1},
			UUID:   "00000000-0000-0000-0000-" + fmtID(id),
			Name:   "existing",
		}).Error)
	}

	ServerMutationMu.Lock()
	server, err := CreateServerWithLowestAvailableID(1, "10000000-0000-0000-0000-000000000011", "replacement")
	ServerMutationMu.Unlock()
	require.NoError(t, err)
	require.EqualValues(t, 11, server.ID)
}

func TestPermanentlyDeleteServersPurgesDirectRowsAndBlocksUUID(t *testing.T) {
	setupPermanentDeleteTest(t)

	server := model.Server{
		Common: model.Common{ID: 11, UserID: 1},
		UUID:   "20000000-0000-0000-0000-000000000011",
		Name:   "delete-me",
	}
	require.NoError(t, DB.Create(&server).Error)
	model.InitServer(&server)
	ServerShared.Update(&server, server.UUID)

	require.NoError(t, DB.Create(&model.ServerGroupServer{ServerGroupId: 1, ServerId: 11}).Error)
	require.NoError(t, DB.Create(&model.Transfer{ServerID: 11, In: 1, Out: 2}).Error)
	require.NoError(t, DB.Create(&model.NAT{Common: model.Common{UserID: 1}, ServerID: 11, Name: "nat", Domain: "delete.example"}).Error)
	require.NoError(t, DB.Create(&model.ServerTransfer{ServerID: 11, FromUserID: 1, ToUserID: 2}).Error)
	require.NoError(t, DB.Create(&model.MCPAuditLog{ServerID: 11, Tool: "test"}).Error)
	token := model.APIToken{UserID: 1, Name: "scoped", TokenHash: "hash"}
	token.SetServerIDs([]uint64{11, 12})
	require.NoError(t, DB.Create(&token).Error)

	require.NoError(t, PermanentlyDeleteServers([]uint64{11}))

	require.True(t, IsDeletedServerUUID(server.UUID))
	var tombstone model.ServerDeletionTombstone
	require.NoError(t, DB.First(&tombstone, "uuid = ?", server.UUID).Error)

	var serverCount int64
	require.NoError(t, DB.Model(&model.Server{}).Where("id = ?", 11).Count(&serverCount).Error)
	require.Zero(t, serverCount)
	for _, target := range []any{
		&model.ServerGroupServer{},
		&model.Transfer{},
		&model.NAT{},
		&model.ServerTransfer{},
		&model.MCPAuditLog{},
	} {
		var count int64
		require.NoError(t, DB.Model(target).Where("server_id = ?", 11).Count(&count).Error)
		require.Zero(t, count)
	}

	var savedToken model.APIToken
	require.NoError(t, DB.First(&savedToken, token.ID).Error)
	require.Equal(t, []uint64{12}, savedToken.ServerIDs())

	ServerMutationMu.Lock()
	replacement, err := CreateServerWithLowestAvailableID(1, "30000000-0000-0000-0000-000000000011", "replacement")
	ServerMutationMu.Unlock()
	require.NoError(t, err)
	require.EqualValues(t, 1, replacement.ID, "the allocator must always choose the smallest free positive ID")
}

func TestRemoveDeletedServerReferences(t *testing.T) {
	deleted := map[uint64]struct{}{11: {}}

	ids, changed := removeIDs([]uint64{10, 11, 12}, deleted)
	require.True(t, changed)
	require.Equal(t, []uint64{10, 12}, ids)

	values := map[uint64]bool{11: true, 12: true}
	require.True(t, removeIDMap(values, deleted))
	require.Equal(t, map[uint64]bool{12: true}, values)

	csv, changed := removeIDsFromCSV("10,11,12", deleted)
	require.True(t, changed)
	require.Equal(t, "10,12", csv)
}

func fmtID(id uint64) string {
	return fmt.Sprintf("%012d", id)
}
