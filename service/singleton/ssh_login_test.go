package singleton

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func sshTestDB(t *testing.T) time.Time {
	t.Helper()
	oldDB, oldNotification := DB, NotificationShared
	db, e := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "ssh.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, e)
	sql, e := db.DB()
	require.NoError(t, e)
	sql.SetMaxOpenConns(1)
	DB = db
	require.NoError(t, DB.AutoMigrate(&model.Server{}, &model.SSHLoginPolicy{}, &model.SSHLoginEvent{}, &model.SSHLoginReceipt{}, &model.SSHUnbanCommand{}, &SSHLoginDelivery{}))
	sshLocal.Lock()
	sshLocal.states = nil
	sshLocal.requests = nil
	sshLocal.Unlock()
	NotificationShared = NewEmptyNotificationClassForTest()
	for _, id := range []uint64{1, 2} {
		NotificationShared.InsertForTest(&model.Notification{Common: model.Common{ID: id}, Name: fmt.Sprint(id)})
	}
	NotificationShared.UpdateGroup(&model.NotificationGroup{Common: model.Common{ID: 7}}, []uint64{1, 2})
	for i, uuid := range []string{"node-a", "node-b"} {
		require.NoError(t, DB.Create(&model.Server{Common: model.Common{ID: uint64(i + 1)}, UUID: uuid, Name: uuid}).Error)
		p := model.DefaultSSHLoginPolicy()
		p.UUID = uuid
		p.Enabled = true
		p.NotificationGroupID = 7
		p.Revision = 3
		p.Ports = []uint16{2222}
		require.NoError(t, DB.Create(&p).Error)
	}
	t.Cleanup(func() {
		sql.Close()
		DB = oldDB
		NotificationShared = oldNotification
		sshLocal.Lock()
		sshLocal.states = nil
		sshLocal.requests = nil
		sshLocal.Unlock()
	})
	return time.Now().Truncate(time.Second)
}
func sshTestEvent(id int, now time.Time) model.SSHLoginEvent {
	return model.SSHLoginEvent{ID: fmt.Sprintf("%064x", id), Time: now.UnixMilli(), Username: "tester", SourceIP: "192.0.2.1", SourcePort: 40000, Port: 2222, Method: "password", Reason: "认证失败"}
}
func TestSSHReportsBindIdentityDeduplicateAndValidateAtomically(t *testing.T) {
	now := sshTestDB(t)
	e := sshTestEvent(1, now)
	e.UUID = "node-b"
	report := model.SSHLoginReport{Events: []model.SSHLoginEvent{e}, Status: model.SSHLoginStatus{Revision: 3}}
	_, err := ReceiveSSHLogin("node-a", report, now)
	require.NoError(t, err)
	_, err = ReceiveSSHLogin("node-a", report, now)
	require.NoError(t, err)
	var stored []model.SSHLoginEvent
	require.NoError(t, DB.Find(&stored).Error)
	require.Len(t, stored, 1)
	require.Equal(t, "node-a", stored[0].UUID)
	bad := sshTestEvent(2, now)
	bad.Username = "inject\nmessage"
	_, err = ReceiveSSHLogin("node-a", model.SSHLoginReport{Events: []model.SSHLoginEvent{sshTestEvent(3, now), bad}}, now)
	require.Error(t, err)
	var count int64
	require.NoError(t, DB.Model(&model.SSHLoginEvent{}).Count(&count).Error)
	require.EqualValues(t, 1, count)
	wrongPort := sshTestEvent(4, now)
	wrongPort.Port = 22
	_, err = ReceiveSSHLogin("node-a", model.SSHLoginReport{Events: []model.SSHLoginEvent{wrongPort}}, now)
	require.NoError(t, err)
	require.NoError(t, DB.Model(&model.SSHLoginEvent{}).Count(&count).Error)
	require.EqualValues(t, 1, count)
	other := model.SSHUnbanCommand{UUID: "node-b", IP: "192.0.2.1", CreatedAt: now.Unix()}
	require.NoError(t, DB.Create(&other).Error)
	_, err = ReceiveSSHLogin("node-a", model.SSHLoginReport{Completed: []uint64{other.ID}}, now)
	require.NoError(t, err)
	require.NoError(t, DB.First(&other, other.ID).Error)
	require.False(t, other.Done)
}
func TestSSHNotificationPartialRetryAndNoPanelHistory(t *testing.T) {
	now := sshTestDB(t)
	first := sshTestEvent(1, now.Add(-2*time.Minute))
	_, e := ReceiveSSHLogin("node-a", model.SSHLoginReport{Events: []model.SSHLoginEvent{first}}, now.Add(-2*time.Minute))
	require.NoError(t, e)
	sent := map[uint64][]string{}
	failSecond := true
	send := func(n *model.Notification, _ *model.Server, events []model.SSHLoginEvent) error {
		if n.ID == 2 && failSecond {
			return fmt.Errorf("fixture unavailable")
		}
		for _, event := range events {
			sent[n.ID] = append(sent[n.ID], event.ID)
		}
		return nil
	}
	require.NoError(t, sendSSHLoginNotifications(now, send))
	require.Len(t, sent[1], 1)
	require.Empty(t, sent[2])
	second := sshTestEvent(2, firstTime(first))
	second.ReceivedAt = now.Add(-2 * time.Minute).Unix()
	_, e = ReceiveSSHLogin("node-a", model.SSHLoginReport{Events: []model.SSHLoginEvent{second}}, now.Add(-2*time.Minute))
	require.NoError(t, e)
	failSecond = false
	require.NoError(t, sendSSHLoginNotifications(now.Add(61*time.Second), send))
	require.Equal(t, []string{first.ID, second.ID}, sent[1])
	require.ElementsMatch(t, []string{first.ID, second.ID}, sent[2])
	var count int64
	require.NoError(t, DB.Model(&model.SSHLoginEvent{}).Count(&count).Error)
	require.Zero(t, count, "delivered history must not remain on panel")
	_, e = ReceiveSSHLogin("node-a", model.SSHLoginReport{Events: []model.SSHLoginEvent{first, second}}, now)
	require.NoError(t, e)
	require.NoError(t, sendSSHLoginNotifications(now.Add(2*time.Minute), send))
	require.Len(t, sent[1], 2)
	require.Len(t, sent[2], 2)
}
func firstTime(e model.SSHLoginEvent) time.Time { return time.UnixMilli(e.Time) }
func TestSSHLocalHistoryQueryDoesNotUseDatabaseOrCrossServers(t *testing.T) {
	now := sshTestDB(t)
	observeSSHLocal("node-a", model.SSHLoginReport{}, now)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	result := make(chan []model.SSHLoginEvent, 1)
	failure := make(chan error, 1)
	go func() {
		events, e := ReadSSHLocalEvents(ctx, "node-a")
		if e != nil {
			failure <- e
		} else {
			result <- events
		}
	}()
	var query uint64
	for deadline := time.Now().Add(time.Second); time.Now().Before(deadline); {
		query = observeSSHLocal("node-a", model.SSHLoginReport{}, now)
		if query != 0 {
			break
		}
		time.Sleep(time.Millisecond)
	}
	require.NotZero(t, query)
	event := sshTestEvent(5, now)
	observeSSHLocal("node-b", model.SSHLoginReport{QueryID: query, Recent: []model.SSHLoginEvent{event}}, now)
	select {
	case <-result:
		t.Fatal("another server answered the query")
	default:
	}
	observeSSHLocal("node-a", model.SSHLoginReport{QueryID: query, Recent: []model.SSHLoginEvent{event}}, now)
	select {
	case events := <-result:
		require.Len(t, events, 1)
		require.Equal(t, event.ID, events[0].ID)
	case e := <-failure:
		t.Fatal(e)
	case <-ctx.Done():
		t.Fatal("local query timed out")
	}
	var count int64
	require.NoError(t, DB.Model(&model.SSHLoginEvent{}).Count(&count).Error)
	require.Zero(t, count)
	_, e := ReadSSHLocalEvents(context.Background(), "offline")
	require.ErrorContains(t, e, "无法读取")
}
func TestSSHPolicyAndBlacklistValidation(t *testing.T) {
	p := model.DefaultSSHLoginPolicy()
	p.WhitelistOnly = true
	require.NoError(t, p.Validate())
	p.Enabled = true
	p.NotificationGroupID = 1
	require.Error(t, p.Validate())
	p.Allowlist = []string{"192.0.2.0/24", "2001:db8::/32"}
	require.NoError(t, p.Validate())
	p.Allowlist = []string{"192.0.2.1; reboot"}
	require.Error(t, p.Validate())
	p = model.DefaultSSHLoginPolicy()
	p.Ports = []uint16{22, 22}
	require.Error(t, p.Validate())
	p = model.DefaultSSHLoginPolicy()
	p.BlockIPs = []string{"192.0.2.0/24", "2001:db8::1"}
	require.NoError(t, p.Validate())
	p.Enabled = true
	p.NotificationGroupID = 1
	require.NoError(t, CompileSSHBlacklist(context.Background(), &p))
	require.NotEmpty(t, p.BlockData)
	p.BlockIPs = []string{"192.0.2.1; reboot"}
	require.Error(t, p.Validate())
}
