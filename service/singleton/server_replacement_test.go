package singleton

import (
	"errors"
	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"testing"
	"time"
)

func replacementFixture(t *testing.T) *model.Server {
	setupPermanentDeleteTest(t)
	oldConf, oldCron := Conf, CronShared
	oldStore, oldPrev := alertsStore, alertsPrevState
	Conf, CronShared = nil, nil
	t.Cleanup(func() { Conf, CronShared = oldConf, oldCron; alertsStore, alertsPrevState = oldStore, oldPrev })
	oldHook, oldCache := ReplacementDataCleanupHook, ServiceSentinelShared
	ReplacementDataCleanupHook = nil
	ServiceSentinelShared = nil
	replacementClearing.Clear()
	t.Cleanup(func() {
		ReplacementDataCleanupHook = oldHook
		ServiceSentinelShared = oldCache
		replacementClearing.Clear()
	})
	require.NoError(t, DB.AutoMigrate(&model.ServerReplacement{}, &model.ServerInventoryBaseline{}, &model.ServerIPHistory{}, &model.ServerSnapshot{}, &model.ServiceHistory{}, &model.PlanTrafficCheckpoint{}, &model.PlanTrafficDay{}, &model.AgentUUIDConflict{}))
	for _, id := range []uint64{7, 8} {
		s := model.Server{Common: model.Common{ID: id, UserID: 1}, Name: "preserved", UUID: "replacement-" + string(rune('a'+id)), DisplayIndex: 25, Note: "keep"}
		require.NoError(t, DB.Create(&s).Error)
		require.NoError(t, DB.Create(&model.Transfer{ServerID: id, In: 500}).Error)
		require.NoError(t, DB.Create(&model.PlanTrafficDay{UUID: s.UUID, Day: "2026-10-12", In: 600}).Error)
	}
	ServerShared = NewServerClass()
	s, _ := ServerShared.Get(7)
	_, err := s.RuntimeHandle().RefreshHostReport(&model.Host{Platform: "debian", BootTime: 500}, time.Now(), nil)
	require.NoError(t, err)
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		return model.RecordServerInventory(tx, s, model.HostInventoryValues(s.RuntimeSnapshot().Host))
	}))
	return s
}
func TestReplacementOnlyExplicitCompleteReportClearsOnce(t *testing.T) {
	s := replacementFixture(t)
	secret, _, err := IssueServerReplacement(s.UUID, model.ServerOperationActor{ID: 1, Name: "admin"})
	require.NoError(t, err)
	require.NotEmpty(t, secret)
	var count int64
	require.NoError(t, DB.Model(&model.Transfer{}).Where("server_id = ?", 7).Count(&count).Error)
	require.EqualValues(t, 1, count)
	_, _, err = AuthorizeServerReplacement(secret, "another-uuid")
	require.Error(t, err)
	_, err = CompleteServerReplacement(secret, s.UUID, nil, &model.HostState{})
	require.Error(t, err)
	require.NoError(t, DB.Model(&model.Transfer{}).Where("server_id = ?", 7).Count(&count).Error)
	require.EqualValues(t, 1, count)
	host := &model.Host{Platform: "ubuntu", PlatformVersion: "24.04", BootTime: 100}
	state := &model.HostState{NetInTransfer: 999999, NetOutTransfer: 555555, Uptime: 100}
	fresh, err := CompleteServerReplacement(secret, s.UUID, host, state)
	require.NoError(t, err)
	require.Equal(t, s.ID, fresh.ID)
	require.Equal(t, s.UUID, fresh.UUID)
	require.Equal(t, s.DisplayIndex, fresh.DisplayIndex)
	require.Empty(t, fresh.Note)
	require.EqualValues(t, 1, fresh.MachineGeneration)
	require.EqualValues(t, 999999, fresh.RuntimeSnapshot().PrevTransferInSnapshot)
	require.NoError(t, DB.Model(&model.Transfer{}).Where("server_id = ?", 7).Count(&count).Error)
	require.Zero(t, count)
	require.NoError(t, DB.Model(&model.Transfer{}).Where("server_id = ?", 8).Count(&count).Error)
	require.EqualValues(t, 1, count)
	require.NoError(t, DB.Model(&model.PlanTrafficDay{}).Where("uuid = ?", s.UUID).Count(&count).Error)
	require.Zero(t, count)
	require.NoError(t, DB.Model(&model.ServerOperationLog{}).Where("server_uuid = ?", s.UUID).Count(&count).Error)
	require.Zero(t, count)
	sample := model.RecordedServerState{At: time.Now().UnixMilli(), Host: host, State: state}
	require.NoError(t, recordPlanTraffic(DB, fresh.ID, fresh.UUID, sample))
	sample.At += 1000
	sample.State = &model.HostState{NetInTransfer: 1000099, NetOutTransfer: 555605, Uptime: 101}
	require.NoError(t, recordPlanTraffic(DB, fresh.ID, fresh.UUID, sample))
	var day model.PlanTrafficDay
	require.NoError(t, DB.First(&day, "uuid = ?", fresh.UUID).Error)
	require.EqualValues(t, 100, day.In)
	// Reconnect with activated credential must neither clear history nor reset day totals.
	again, err := CompleteServerReplacement(secret, s.UUID, host, state)
	require.NoError(t, err)
	require.Equal(t, fresh, again)
	require.NoError(t, DB.First(&day, "uuid = ?", fresh.UUID).Error)
	require.EqualValues(t, 100, day.In)
	oldResult, err := s.RuntimeHandle().RefreshHostReport(host, time.Now(), nil)
	require.Error(t, err)
	require.False(t, oldResult.Applied)
}
func TestReplacementExpiryReissueAndInterruptedCleanup(t *testing.T) {
	s := replacementFixture(t)
	first, _, err := IssueServerReplacement(s.UUID, model.ServerOperationActor{})
	require.NoError(t, err)
	second, _, err := IssueServerReplacement(s.UUID, model.ServerOperationActor{})
	require.NoError(t, err)
	_, _, err = AuthorizeServerReplacement(first, s.UUID)
	require.Error(t, err)
	require.NoError(t, DB.Model(&model.ServerReplacement{}).Where("token_hash = ?", replacementHash(second)).Update("expires_at", time.Now().Add(-time.Minute)).Error)
	_, _, err = AuthorizeServerReplacement(second, s.UUID)
	require.Error(t, err)
	secret, _, err := IssueServerReplacement(s.UUID, model.ServerOperationActor{})
	require.NoError(t, err)
	ReplacementDataCleanupHook = func(*gorm.DB, *model.Server) (func(), error) { return nil, errors.New("injected failure") }
	_, err = CompleteServerReplacement(secret, s.UUID, &model.Host{Platform: "ubuntu"}, &model.HostState{})
	require.Error(t, err)
	var count int64
	require.NoError(t, DB.Model(&model.Transfer{}).Where("server_id = ?", 7).Count(&count).Error)
	require.EqualValues(t, 1, count)
	require.True(t, ServerReplacementClearing(s.UUID))
	replacementClearing.Clear()
	require.NoError(t, initReplacementClearing())
	require.True(t, ServerReplacementClearing(s.UUID))
	ReplacementDataCleanupHook = nil
	_, err = CompleteServerReplacement(secret, s.UUID, &model.Host{Platform: "ubuntu"}, &model.HostState{})
	require.NoError(t, err)
	require.False(t, ServerReplacementClearing(s.UUID))
}
