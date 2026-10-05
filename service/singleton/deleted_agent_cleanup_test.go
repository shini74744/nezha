package singleton

import (
	"encoding/json"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
)

func cleanupFixture(t *testing.T) model.ServerDeletionTombstone {
	setupPermanentDeleteTest(t)
	oldUsers, oldSecrets := UserInfoMap, AgentSecretToUserId
	UserInfoMap = map[uint64]model.UserInfo{100: {Role: model.RoleAdmin}}
	AgentSecretToUserId = map[string]uint64{"fixture-owner-key": 100, "fixture-other-key": 200}
	t.Cleanup(func() { UserInfoMap, AgentSecretToUserId = oldUsers, oldSecrets })
	row := model.ServerDeletionTombstone{UUID: releaseFixtureUUID, Name: "cleanup fixture", OriginalID: 42, CleanupOwnerID: 100, CleanupPlatform: "ubuntu"}
	require.NoError(t, DB.Create(&row).Error)
	require.NoError(t, initDeletedServerUUIDs())
	return row
}

func armCleanup(t *testing.T, row model.ServerDeletionTombstone) *model.ServerDeletionTombstone {
	t.Helper()
	armed, err := ConfigureDeletedCleanup(row.UUID, row.BlockVersion, row.CleanupRevision, true, model.ServerOperationActor{ID: 1, Name: "admin"})
	require.NoError(t, err)
	return armed
}

func TestDeletedCleanupOptInCredentialAndOneShot(t *testing.T) {
	row := cleanupFixture(t)
	_, ok := AuthorizeDeletedCleanup(row.UUID, "fixture-owner-key")
	require.False(t, ok)
	row.CleanupCredentialHash = cleanupCredentialHash("verified-transfer-fixture")
	require.NoError(t, DB.Model(&row).Update("cleanup_credential_hash", row.CleanupCredentialHash).Error)
	armed := armCleanup(t, row)
	for _, secret := range []string{"", "wrong", "fixture-other-key"} {
		_, ok = AuthorizeDeletedCleanup(row.UUID, secret)
		require.False(t, ok)
	}
	for _, secret := range []string{"fixture-owner-key", "verified-transfer-fixture"} {
		_, ok = AuthorizeDeletedCleanup(row.UUID, secret)
		require.True(t, ok)
	}
	serialized, err := json.Marshal(armed)
	require.NoError(t, err)
	require.NotContains(t, string(serialized), "cleanup_owner_id")
	require.NotContains(t, string(serialized), "cleanup_credential_hash")
	var sent atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = DispatchDeletedCleanup(armed, "fixture-owner-key", func() error { sent.Add(1); return nil })
		}()
	}
	wg.Wait()
	require.EqualValues(t, 1, sent.Load())
	require.NoError(t, FinishDeletedCleanup(armed, "started", "fixture started"))
	require.NoError(t, initDeletedServerUUIDs())
	_, ok = AuthorizeDeletedCleanup(row.UUID, "fixture-owner-key")
	require.False(t, ok)
	require.True(t, IsDeletedServerUUID(row.UUID))
	var saved model.ServerDeletionTombstone
	require.NoError(t, DB.First(&saved, "uuid = ?", row.UUID).Error)
	require.Equal(t, "started", saved.CleanupState)
	require.False(t, saved.CleanupEnabled)
	require.EqualValues(t, 1, saved.CleanupAttempts)
	var logs int64
	require.NoError(t, DB.Model(&model.ServerOperationLog{}).Count(&logs).Error)
	require.EqualValues(t, 3, logs)
}

func TestDeletedCleanupCancelReleaseAndRearmInvalidateOldRequests(t *testing.T) {
	row := cleanupFixture(t)
	armed := armCleanup(t, row)
	require.NoError(t, initDeletedServerUUIDs())
	_, ok := AuthorizeDeletedCleanup(row.UUID, "fixture-owner-key")
	require.True(t, ok, "waiting survives restart")
	off, err := ConfigureDeletedCleanup(row.UUID, 1, armed.CleanupRevision, false, model.ServerOperationActor{})
	require.NoError(t, err)
	sends := 0
	send := func() error { sends++; return nil }
	require.ErrorIs(t, DispatchDeletedCleanup(armed, "fixture-owner-key", send), ErrDeletedCleanupChanged)
	require.Zero(t, sends)
	rearmed := armCleanup(t, *off)
	require.ErrorIs(t, DispatchDeletedCleanup(armed, "fixture-owner-key", send), ErrDeletedCleanupChanged)
	_, err = ConfigureDeletedCleanup(row.UUID, 1, armed.CleanupRevision, false, model.ServerOperationActor{})
	require.Error(t, err, "stale UI cannot cancel a new attempt")
	_, err = ReleaseDeletedServerUUID(row.UUID, 1, model.ServerOperationActor{})
	require.NoError(t, err)
	require.ErrorIs(t, DispatchDeletedCleanup(rearmed, "fixture-owner-key", send), ErrDeletedCleanupChanged)
	require.Zero(t, sends)
}

func TestDeletedCleanupCrashAndAuditFailureFailClosed(t *testing.T) {
	row := cleanupFixture(t)
	require.NoError(t, DB.Exec("CREATE TRIGGER reject_cleanup_audit BEFORE INSERT ON server_operation_logs BEGIN SELECT RAISE(ABORT,'fixture'); END").Error)
	_, err := ConfigureDeletedCleanup(row.UUID, 1, 0, true, model.ServerOperationActor{})
	require.Error(t, err)
	require.NoError(t, DB.First(&row, "uuid = ?", row.UUID).Error)
	require.False(t, row.CleanupEnabled)
	require.NoError(t, DB.Exec("DROP TRIGGER reject_cleanup_audit").Error)
	armed := armCleanup(t, row)
	require.NoError(t, DB.Exec("CREATE TRIGGER reject_cleanup_audit BEFORE INSERT ON server_operation_logs BEGIN SELECT RAISE(ABORT,'fixture'); END").Error)
	sent := false
	require.Error(t, DispatchDeletedCleanup(armed, "fixture-owner-key", func() error { sent = true; return nil }))
	require.False(t, sent)
	require.NoError(t, DB.Exec("DROP TRIGGER reject_cleanup_audit").Error)
	require.Error(t, DispatchDeletedCleanup(armed, "fixture-owner-key", func() error { return errors.New("simulated network drop") }))
	require.NoError(t, initDeletedServerUUIDs())
	require.NoError(t, DB.First(&row, "uuid = ?", row.UUID).Error)
	require.Equal(t, "unknown", row.CleanupState)
	require.False(t, row.CleanupEnabled)
	require.EqualValues(t, 1, row.CleanupAttempts)
	require.True(t, IsDeletedServerUUID(row.UUID))
}

func TestDeletedCleanupUnsupportedAndCredentialRotation(t *testing.T) {
	for _, tc := range []struct {
		name, platform string
		owner          uint64
		released       int64
	}{
		{"legacy", "ubuntu", 0, 0}, {"missing platform", "", 100, 0}, {"f50", "f50", 100, 0}, {"android", "android", 100, 0}, {"released", "ubuntu", 100, 1}, {"missing owner", "ubuntu", 999, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			row := cleanupFixture(t)
			require.NoError(t, DB.Model(&row).Updates(map[string]any{"cleanup_owner_id": tc.owner, "cleanup_platform": tc.platform, "released_at": tc.released}).Error)
			_, err := ConfigureDeletedCleanup(row.UUID, 1, 0, true, model.ServerOperationActor{})
			require.Error(t, err)
		})
	}
	row := cleanupFixture(t)
	armed := armCleanup(t, row)
	delete(AgentSecretToUserId, "fixture-owner-key")
	_, ok := AuthorizeDeletedCleanup(row.UUID, "fixture-owner-key")
	require.False(t, ok)
	require.ErrorIs(t, DispatchDeletedCleanup(armed, "fixture-owner-key", func() error { t.Fatal("revoked key sent a command"); return nil }), ErrDeletedCleanupChanged)
}

func TestDeletedCleanupProfileCapturedAndResetOnNewDeletion(t *testing.T) {
	row := cleanupFixture(t)
	_, err := ReleaseDeletedServerUUID(row.UUID, 1, model.ServerOperationActor{})
	require.NoError(t, err)
	ServerMutationMu.Lock()
	server, err := CreateServerWithLowestAvailableID(100, row.UUID, "normal server")
	ServerMutationMu.Unlock()
	require.NoError(t, err)
	model.InitServer(server)
	_, err = server.RuntimeHandle().ApplyHostReport(&model.Host{Platform: "ubuntu"}, time.Now(), nil)
	require.NoError(t, err)
	ServerShared.Update(server, server.UUID)
	require.NoError(t, PermanentlyDeleteServers([]uint64{server.ID}))
	require.NoError(t, DB.First(&row, "uuid = ?", row.UUID).Error)
	require.Equal(t, "ubuntu", row.CleanupPlatform)
	require.EqualValues(t, 100, row.CleanupOwnerID)
	require.EqualValues(t, 2, row.BlockVersion)
	require.False(t, row.CleanupEnabled)
	require.Zero(t, row.CleanupAttempts)
}

func TestDeletedCleanupTransferIdentityMustBeSettled(t *testing.T) {
	c := &ServerTransferClass{
		pending:                make(map[uint64]*model.ServerTransfer),
		terminalSecretRecovery: make(map[uint64]*model.ServerTransfer),
		verifiedHandshakes:     map[uint64]string{42: "verified-fixture"},
	}
	owner, digest := c.deletedCleanupIdentity(42, 100)
	require.EqualValues(t, 100, owner)
	require.Equal(t, cleanupCredentialHash("verified-fixture"), digest)
	c.pending[42] = &model.ServerTransfer{}
	owner, digest = c.deletedCleanupIdentity(42, 200)
	require.Zero(t, owner)
	require.Empty(t, digest)
	delete(c.pending, 42)
	c.terminalSecretRecovery[42] = &model.ServerTransfer{}
	owner, digest = c.deletedCleanupIdentity(42, 100)
	require.Zero(t, owner)
	require.Empty(t, digest)
}
