package singleton

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestReplacementFullResetOnlyTargetAndDefaults(t *testing.T) {
	s := replacementFixture(t)
	require.NoError(t, DB.AutoMigrate(&model.TerminalSession{}, &model.TerminalSessionEvent{}, &model.ServerExpiryDelivery{}, &model.ServerGroup{}, &model.Notification{}, &model.NotificationGroup{}))
	require.NoError(t, DB.Model(&model.Server{}).Where("id = ?", s.ID).Updates(map[string]any{
		"name": "old-machine", "note": "private", "public_note": "{\"billing\":\"old dates and package\"}",
		"hide_for_guest": true, "hide_for_display": true, "network_default_view": "latency",
		"network_display_mode": "latency", "connectivity_disabled": true, "connectivity_local_only": true,
		"bgp_disabled": true, "return_route_disabled": true, "streaming_disabled": true,
		"EnableDDNS": true, "ddns_profiles_raw": "[9]", "override_ddns_domains_raw": "{\"9\":[\"old.example\"]}",
	}).Error)
	require.NoError(t, DB.Create(&model.ServerGroup{Common: model.Common{ID: 3, UserID: 1}, Name: "shared"}).Error)
	require.NoError(t, DB.Create(&model.NotificationGroup{Common: model.Common{ID: 4, UserID: 1}, Name: "shared"}).Error)
	for _, id := range []uint64{7, 8} {
		uuid := "replacement-" + string(rune('a'+id))
		for _, value := range []any{
			&model.ServerGroupServer{ServerId: id, ServerGroupId: 3},
			&model.NAT{Common: model.Common{ID: id}, ServerID: id, Domain: uuid + ".example"},
			&model.MCPAuditLog{ServerID: id},
			&model.ServerTransfer{ServerID: id, Status: model.ServerTransferStatusVerified},
			&model.TerminalSession{Common: model.Common{ID: id}, ServerID: id, ServerUUID: uuid, Name: "old terminal"},
			&model.TerminalSessionEvent{SessionID: id, ServerUUID: uuid, Name: "old event"},
			&model.ServerExpiryDelivery{UUID: uuid, ExpiresAt: 123, Days: 1, NotificationID: 4, SentAt: 100},
		} {
			require.NoError(t, DB.Create(value).Error)
		}
	}
	require.NoError(t, model.RecordServerInventory(DB, s, map[string]string{"ipv4": "192.0.2.7", "ipv6": "2001:db8::7"}))
	// Historical rows sharing the reused numeric ID belong to a different UUID.
	require.NoError(t, DB.Create(&model.ServerOperationLog{ServerUUID: "previous-id-owner", ServerID: 7, ServerName: "keep-history"}).Error)
	cr := model.Cron{Common: model.Common{ID: 1}, TaskType: model.CronTypeTriggerTask, Cover: model.CronCoverIgnoreAll, Servers: []uint64{7, 8}}
	require.NoError(t, DB.Create(&cr).Error)
	CronShared = &CronClass{class: class[uint64, *model.Cron]{list: map[uint64]*model.Cron{1: &cr}}, pendingAlertTriggerTasks: map[uint64]map[uint64][]time.Time{1: {7: {time.Now()}, 8: {time.Now()}}}}
	service := model.Service{Common: model.Common{ID: 1}, Type: 2, SkipServers: map[uint64]bool{7: true, 8: true}}
	require.NoError(t, DB.Create(&service).Error)
	alert := model.AlertRule{Common: model.Common{ID: 1}, Rules: []*model.Rule{{Type: "offline", Cover: model.RuleCoverIgnoreAll, Ignore: map[uint64]bool{7: true, 8: true}}}, NotificationGroupID: 4}
	require.NoError(t, DB.Create(&alert).Error)
	Alerts = []*model.AlertRule{&alert}
	alertsStore = map[uint64]map[uint64][][]bool{1: {7: {{false}}, 8: {{true}}}}
	alertsPrevState = map[uint64]map[uint64]uint8{1: {7: 1, 8: 2}}
	require.NoError(t, DB.Create(&model.APIToken{ID: 1, TokenHash: model.HashAPIToken("target-fixture"), ServersCSV: "7"}).Error)
	require.NoError(t, DB.Create(&model.APIToken{ID: 2, TokenHash: model.HashAPIToken("shared-fixture"), ServersCSV: "7,8"}).Error)
	secret, _, err := IssueServerReplacement(s.UUID, model.ServerOperationActor{})
	require.NoError(t, err)
	fresh, err := CompleteServerReplacement(secret, s.UUID, &model.Host{Platform: "new-os"}, &model.HostState{})
	require.NoError(t, err)
	require.Equal(t, s.ID, fresh.ID)
	require.Equal(t, s.UUID, fresh.UUID)
	require.Equal(t, s.DisplayIndex, fresh.DisplayIndex)
	require.Equal(t, s.UserID, fresh.UserID)
	require.Equal(t, "新服务器", fresh.Name)
	require.Empty(t, fresh.Note)
	require.Empty(t, fresh.PublicNote)
	require.Equal(t, "connectivity", fresh.NetworkDefaultView)
	require.Empty(t, fresh.NetworkDisplayMode)
	for _, value := range []bool{fresh.HideForGuest, fresh.HideForDisplay, fresh.ConnectivityDisabled, fresh.ConnectivityLocalOnly, fresh.BGPDisabled, fresh.ReturnRouteDisabled, fresh.StreamingDisabled, fresh.EnableDDNS} {
		require.False(t, value)
	}
	require.Empty(t, fresh.DDNSProfiles)
	require.Empty(t, fresh.OverrideDDNSDomains)
	for _, target := range []any{&model.ServerGroupServer{}, &model.NAT{}, &model.MCPAuditLog{}, &model.ServerTransfer{}} {
		var targetCount, otherCount int64
		require.NoError(t, DB.Model(target).Where("server_id = ?", 7).Count(&targetCount).Error)
		require.NoError(t, DB.Model(target).Where("server_id = ?", 8).Count(&otherCount).Error)
		require.Zero(t, targetCount)
		require.EqualValues(t, 1, otherCount)
	}
	for _, target := range []any{&model.TerminalSession{}, &model.TerminalSessionEvent{}, &model.ServerOperationLog{}} {
		var count int64
		require.NoError(t, DB.Model(target).Where("server_uuid = ?", s.UUID).Count(&count).Error)
		require.Zero(t, count)
	}
	var count int64
	require.NoError(t, DB.Model(&model.ServerOperationLog{}).Where("server_uuid = ?", "previous-id-owner").Count(&count).Error)
	require.EqualValues(t, 1, count)
	require.NoError(t, DB.Model(&model.ServerExpiryDelivery{}).Where("uuid = ?", s.UUID).Count(&count).Error)
	require.Zero(t, count)
	require.NoError(t, DB.Model(&model.NotificationGroup{}).Count(&count).Error)
	require.EqualValues(t, 1, count)
	require.NoError(t, DB.Model(&model.ServerGroup{}).Count(&count).Error)
	require.EqualValues(t, 1, count)
	require.NoError(t, DB.First(&cr, 1).Error)
	require.Equal(t, []uint64{8}, cr.Servers)
	require.NotContains(t, CronShared.pendingAlertTriggerTasks[1], uint64(7))
	require.Len(t, CronShared.pendingAlertTriggerTasks[1][8], 1)
	service = model.Service{}
	require.NoError(t, DB.First(&service, 1).Error)
	require.Equal(t, map[uint64]bool{8: true}, service.SkipServers)
	alert = model.AlertRule{}
	require.NoError(t, DB.First(&alert, 1).Error)
	require.Equal(t, map[uint64]bool{8: true}, alert.Rules[0].Ignore)
	require.EqualValues(t, 4, alert.NotificationGroupID)
	require.NotContains(t, alertsStore[1], uint64(7))
	require.Equal(t, [][]bool{{true}}, alertsStore[1][8])
	require.EqualValues(t, 2, alertsPrevState[1][8])
	var tokens []model.APIToken
	require.NoError(t, DB.Find(&tokens).Error)
	require.Len(t, tokens, 1)
	require.Equal(t, "8", tokens[0].ServersCSV)
	var baseline model.ServerInventoryBaseline
	require.NoError(t, DB.First(&baseline, "server_uuid = ?", s.UUID).Error)
	require.Equal(t, "new-os", baseline.Values["operating_system"])
	require.NotContains(t, baseline.Values, "ipv6")
	require.NoError(t, model.RecordServerInventory(DB, fresh, model.HostInventoryValues(&model.Host{Platform: "new-os"})))
	require.NoError(t, DB.Model(&model.ServerOperationLog{}).Where("server_uuid = ?", s.UUID).Count(&count).Error)
	require.Zero(t, count, "identical new-machine reports must not recreate old history")
}

func TestReplacementLegacyScopeCannotExpand(t *testing.T) {
	for _, state := range []string{"pending", "clearing", "active"} {
		t.Run(state, func(t *testing.T) {
			s := replacementFixture(t)
			secret, _, err := IssueServerReplacement(s.UUID, model.ServerOperationActor{})
			require.NoError(t, err)
			require.NoError(t, DB.Model(&model.ServerReplacement{}).Where("token_hash = ?", replacementHash(secret)).Updates(map[string]any{"reset_scope": "", "state": state}).Error)
			fresh, err := CompleteServerReplacement(secret, s.UUID, &model.Host{Platform: "ubuntu"}, &model.HostState{})
			if state == "pending" {
				require.ErrorContains(t, err, "重新确认")
			} else {
				require.NoError(t, err)
				require.Equal(t, "keep", fresh.Note)
			}
			var stored model.Server
			require.NoError(t, DB.First(&stored, s.ID).Error)
			require.Equal(t, "keep", stored.Note)
		})
	}
}

func TestReplacementFullResetRollsBackHistoryAndConfig(t *testing.T) {
	s := replacementFixture(t)
	secret, _, err := IssueServerReplacement(s.UUID, model.ServerOperationActor{})
	require.NoError(t, err)
	// Fail after the full reset and baseline insert but before the transaction
	// can activate the new ticket. Old history/config must remain intact.
	callback := "full-reset-fail-activation"
	require.NoError(t, DB.Callback().Update().Before("gorm:update").Register(callback, func(tx *gorm.DB) {
		if tx.Statement.Table == "server_replacements" {
			if updates, ok := tx.Statement.Dest.(map[string]any); ok && updates["state"] == "active" {
				tx.AddError(errors.New("injected activation failure"))
			}
		}
	}))
	_, err = CompleteServerReplacement(secret, s.UUID, &model.Host{Platform: "ubuntu"}, &model.HostState{})
	require.ErrorContains(t, err, "injected activation failure")
	var stored model.Server
	require.NoError(t, DB.First(&stored, s.ID).Error)
	require.Equal(t, "keep", stored.Note)
	require.Zero(t, stored.MachineGeneration)
	var count int64
	require.NoError(t, DB.Model(&model.ServerOperationLog{}).Where("server_uuid = ?", s.UUID).Count(&count).Error)
	require.EqualValues(t, 1, count)
	require.NoError(t, DB.Callback().Update().Remove(callback))
	fresh, err := CompleteServerReplacement(secret, s.UUID, &model.Host{Platform: "ubuntu"}, &model.HostState{})
	require.NoError(t, err)
	require.Empty(t, fresh.Note)
	require.EqualValues(t, 1, fresh.MachineGeneration)
}

func TestReplacementRotatesOnlyTargetCredential(t *testing.T) {
	s := replacementFixture(t)
	oldUsers := UserInfoMap
	UserInfoMap = map[uint64]model.UserInfo{1: {Role: model.RoleAdmin}}
	t.Cleanup(func() { UserInfoMap = oldUsers })
	require.NoError(t, DB.AutoMigrate(&model.AgentCredential{}, &model.AgentCredentialRejection{}))
	require.NoError(t, InitAgentCredentials(filepath.Join(t.TempDir(), "agent-credentials.key")))
	old := "old-target-private-fixture-1234567890"
	require.NoError(t, AdoptAgentCredential(s.ID, s.UUID, old))
	other, _ := ServerShared.Get(8)
	otherSecret := "other-private-fixture-123456789012345"
	require.NoError(t, AdoptAgentCredential(other.ID, other.UUID, otherSecret))
	secret, _, err := IssueServerReplacement(s.UUID, model.ServerOperationActor{})
	require.NoError(t, err)
	_, err = CompleteServerReplacement(secret, s.UUID, &model.Host{Platform: "ubuntu"}, &model.HostState{})
	require.NoError(t, err)
	_, err = AuthenticateAgentCredential(old, s.UUID)
	require.Error(t, err)
	id, err := AuthenticateAgentCredential(secret, s.UUID)
	require.NoError(t, err)
	require.Equal(t, s.ID, id)
	otherID, err := AuthenticateAgentCredential(otherSecret, other.UUID)
	require.NoError(t, err)
	require.Equal(t, other.ID, otherID)
	_, err = AuthenticateAgentCredential(secret, "other-uuid")
	require.Error(t, err)
	// A successful ticket remains idempotent even after its admission expiry.
	require.NoError(t, DB.Model(&model.ServerReplacement{}).Where("token_hash = ?", replacementHash(secret)).Update("expires_at", time.Now().Add(-time.Hour)).Error)
	_, err = CompleteServerReplacement(secret, s.UUID, &model.Host{Platform: "ubuntu"}, &model.HostState{})
	require.NoError(t, err)
}
