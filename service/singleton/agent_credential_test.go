package singleton

import (
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"path/filepath"
	"sync"
	"testing"
)

func setupCredentialTest(t *testing.T) string {
	t.Helper()
	setupPermanentDeleteTest(t)
	require.NoError(t, DB.AutoMigrate(&model.AgentCredential{}, &model.AgentCredentialRejection{}, &model.ServerReplacement{}, &model.ServerInventoryBaseline{}))
	sqlDB, err := DB.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	previousUsers, previousSecrets := UserInfoMap, AgentSecretToUserId
	UserInfoMap = map[uint64]model.UserInfo{1: {Role: model.RoleAdmin}}
	AgentSecretToUserId = map[string]uint64{"legacy-secret-12345678901234567890": 1}
	t.Cleanup(func() { UserInfoMap = previousUsers; AgentSecretToUserId = previousSecrets })
	path := filepath.Join(t.TempDir(), "agent-credentials.key")
	require.NoError(t, InitAgentCredentials(path))
	return path
}
func TestAgentCredentialUniqueReuseAndRevocation(t *testing.T) {
	setupCredentialTest(t)
	actor := model.ServerOperationActor{ID: 1, Name: "admin"}
	a, err := IssueAgentCredential("", 1, actor)
	require.NoError(t, err)
	b, err := IssueAgentCredential("", 1, actor)
	require.NoError(t, err)
	require.NotEqual(t, a.UUID, b.UUID)
	require.NotEqual(t, a.Secret, b.Secret)
	row, ok := AgentCredentialByUUID(a.UUID)
	require.True(t, ok)
	require.False(t, bytes.Contains(row.SecretSealed, []byte(a.Secret)))
	encoded, err := json.Marshal(row)
	require.NoError(t, err)
	require.NotContains(t, string(encoded), a.Secret)
	same, err := UnusedAgentCredentialPair(a.UUID, a.Version, 1, false, actor)
	require.NoError(t, err)
	require.Equal(t, a, same)
	_, err = UnusedAgentCredentialPair(a.UUID, a.Version, 2, true, actor)
	require.Error(t, err)
	_, err = UnusedAgentCredentialPair(a.UUID, a.Version+1, 1, true, actor)
	require.Error(t, err)
	_, err = UnusedAgentCredentialPair(a.UUID, a.Version, 1, true, actor)
	require.NoError(t, err)
	_, err = AuthenticateAgentCredential(a.Secret, a.UUID)
	require.Error(t, err)
	_, ok = AgentCredentialByUUID(a.UUID)
	require.False(t, ok)
}
func TestAgentCredentialUseDisappearsFromUnusedAndSurvivesRestart(t *testing.T) {
	keyPath := setupCredentialTest(t)
	actor := model.ServerOperationActor{ID: 1}
	pair, err := IssueAgentCredential("", 1, actor)
	require.NoError(t, err)
	id, err := AuthenticateAgentCredential(pair.Secret, pair.UUID)
	require.NoError(t, err)
	require.NotZero(t, id)
	_, err = UnusedAgentCredentialPair(pair.UUID, pair.Version, 1, true, actor)
	require.Error(t, err)
	_, err = AuthenticateAgentCredential(pair.Secret, "00000000-0000-0000-0000-000000000001")
	require.Error(t, err)
	require.NoError(t, InitAgentCredentials(keyPath))
	again, err := AuthenticateAgentCredential(pair.Secret, pair.UUID)
	require.NoError(t, err)
	require.Equal(t, id, again)
	require.Error(t, InitAgentCredentials(filepath.Join(t.TempDir(), "missing.key")), "encrypted rows must never silently regenerate their key")
}
func TestAgentCredentialRegisterDeleteUnusedRace(t *testing.T) {
	setupCredentialTest(t)
	actor := model.ServerOperationActor{ID: 1}
	for n := 0; n < 10; n++ {
		pair, err := IssueAgentCredential("", 1, actor)
		require.NoError(t, err)
		var registerErr, deleteErr error
		var wg sync.WaitGroup
		wg.Add(2)
		go func() { defer wg.Done(); _, registerErr = AuthenticateAgentCredential(pair.Secret, pair.UUID) }()
		go func() {
			defer wg.Done()
			_, deleteErr = UnusedAgentCredentialPair(pair.UUID, pair.Version, 1, true, actor)
		}()
		wg.Wait()
		require.NotEqual(t, registerErr == nil, deleteErr == nil, "exactly one operation may succeed")
		if registerErr == nil {
			row, ok := AgentCredentialByUUID(pair.UUID)
			require.True(t, ok)
			require.NotZero(t, row.VerifiedAt)
		}
	}
}
func TestAgentCredentialDeleteRecordDoesNotReleasePair(t *testing.T) {
	setupCredentialTest(t)
	actor := model.ServerOperationActor{ID: 1}
	pair, err := IssueAgentCredential("", 1, actor)
	require.NoError(t, err)
	id, err := AuthenticateAgentCredential(pair.Secret, pair.UUID)
	require.NoError(t, err)
	require.NoError(t, PermanentlyDeleteServers([]uint64{id}))
	var row model.ServerDeletionTombstone
	require.NoError(t, DB.First(&row, "uuid = ?", pair.UUID).Error)
	_, err = AuthenticateAgentCredential(pair.Secret, pair.UUID)
	require.Error(t, err)
	require.NoError(t, DeleteDeletedServerRecord(row.UUID, row.BlockVersion, row.CleanupRevision, actor))
	require.True(t, IsDeletedServerUUID(pair.UUID))
	require.NoError(t, DB.First(&row, "uuid = ?", pair.UUID).Error)
	require.NotZero(t, row.RecordDeletedAt)
	_, err = AuthenticateAgentCredential(pair.Secret, pair.UUID)
	require.Error(t, err)
	_, err = ReleaseDeletedServerUUID(pair.UUID, row.BlockVersion, actor)
	require.NoError(t, err)
	_, err = AuthenticateAgentCredential(pair.Secret, pair.UUID)
	require.NoError(t, err)
}
func TestAgentCredentialManualAdmissionChecksPairAndVersions(t *testing.T) {
	setupCredentialTest(t)
	actor := model.ServerOperationActor{ID: 1}
	uuid := "cccccccc-1111-4111-8111-111111111111"
	secret := "UnregisteredSecureSecret123456789"
	RecordRejectedAgentCredential(uuid, secret, "192.0.2.20")
	var report model.AgentCredentialRejection
	require.NoError(t, DB.First(&report).Error)
	req := AgentCredentialAdmission{ReportID: report.ID}
	node, err := AdmitAgentCredential(req, actor)
	require.NoError(t, err)
	runtime, _ := ServerShared.Get(node.ID)
	require.Equal(t, uuid, node.UUID)
	id, err := AuthenticateAgentCredential(secret, uuid)
	require.NoError(t, err)
	require.Equal(t, node.ID, id)
	req.BindingVersion = 1
	_, err = AdmitAgentCredential(req, actor)
	require.NoError(t, err)
	current, _ := ServerShared.Get(node.ID)
	require.Same(t, runtime, current, "admission must preserve existing monitoring runtime")
	_, err = AdmitAgentCredential(req, actor)
	require.Error(t, err, "stale UI cannot replace a newer binding")
	other := "dddddddd-1111-4111-8111-111111111111"
	RecordRejectedAgentCredential(other, secret, "192.0.2.21")
	report = model.AgentCredentialRejection{}
	require.NoError(t, DB.First(&report, "uuid = ?", other).Error)
	_, err = AdmitAgentCredential(AgentCredentialAdmission{ReportID: report.ID}, actor)
	require.ErrorContains(t, err, "其他 UUID")
}
func TestAgentCredentialCannotAdmitLegacySharedKey(t *testing.T) {
	setupCredentialTest(t)
	uuid := "eeeeeeee-1111-4111-8111-111111111111"
	RecordRejectedAgentCredential(uuid, "legacy-secret-12345678901234567890", "192.0.2.20")
	var report model.AgentCredentialRejection
	require.NoError(t, DB.First(&report).Error)
	_, err := AdmitAgentCredential(AgentCredentialAdmission{ReportID: report.ID}, model.ServerOperationActor{ID: 1})
	require.ErrorContains(t, err, "共享密钥")
}
func TestRetiredUninstallNeverArmsAgain(t *testing.T) {
	setupCredentialTest(t)
	row := model.ServerDeletionTombstone{UUID: "ffffffff-1111-4111-8111-111111111111", BlockVersion: 1, CleanupEnabled: true, CleanupState: "retry_wait", CleanupCredentialHash: "old", CleanupNextAttemptAt: 123}
	require.NoError(t, DB.Create(&row).Error)
	require.NoError(t, initDeletedServerUUIDs())
	require.NoError(t, DB.First(&row, "uuid = ?", row.UUID).Error)
	require.False(t, row.CleanupEnabled)
	require.Zero(t, row.CleanupNextAttemptAt)
	require.Empty(t, row.CleanupCredentialHash)
	require.True(t, IsDeletedServerUUID(row.UUID))
}

func TestDeletionCallbackOnlyRunsAfterCommitAndNeverOnRollback(t *testing.T) {
	setupCredentialTest(t)
	pair, err := IssueAgentCredential("", 1, model.ServerOperationActor{ID: 1})
	require.NoError(t, err)
	id, err := AuthenticateAgentCredential(pair.Secret, pair.UUID)
	require.NoError(t, err)
	require.NoError(t, DB.Callback().Delete().Before("gorm:delete").Register("fixture:fail_server_delete", func(tx *gorm.DB) {
		if tx.Statement.Table == "servers" {
			tx.AddError(fmt.Errorf("fixture rollback"))
		}
	}))
	called := false
	err = DeleteServersThen([]uint64{id}, nil, func(rows []model.ServerDeletionTombstone) { called = true })
	require.Error(t, err)
	require.False(t, called)
	require.False(t, IsDeletedServerUUID(pair.UUID))
	_, err = AuthenticateAgentCredential(pair.Secret, pair.UUID)
	require.NoError(t, err)
	require.NoError(t, DB.Callback().Delete().Remove("fixture:fail_server_delete"))
	err = DeleteServersThen([]uint64{id}, nil, func(rows []model.ServerDeletionTombstone) {
		called = true
		require.Len(t, rows, 1)
		require.True(t, IsDeletedServerUUID(pair.UUID))
		_, exists := ServerShared.Get(id)
		require.False(t, exists)
		var count int64
		require.NoError(t, DB.Model(&model.Server{}).Where("id = ?", id).Count(&count).Error)
		require.Zero(t, count)
	})
	require.NoError(t, err)
	require.True(t, called)
}

func TestAgentCredentialRegistrationAndVerificationRollbackTogether(t *testing.T) {
	setupCredentialTest(t)
	pair, err := IssueAgentCredential("", 1, model.ServerOperationActor{ID: 1})
	require.NoError(t, err)
	const callback = "credential_fixture:reject_verify"
	require.NoError(t, DB.Callback().Update().Before("gorm:update").Register(callback, func(tx *gorm.DB) {
		if tx.Statement.Schema != nil && tx.Statement.Schema.Name == "AgentCredential" {
			tx.AddError(fmt.Errorf("fixture update failure"))
		}
	}))
	t.Cleanup(func() { DB.Callback().Update().Remove(callback) })
	_, err = AuthenticateAgentCredential(pair.Secret, pair.UUID)
	require.Error(t, err)
	var count int64
	require.NoError(t, DB.Model(&model.Server{}).Where("uuid = ?", pair.UUID).Count(&count).Error)
	require.Zero(t, count)
	_, exists := ServerShared.UUIDToID(pair.UUID)
	require.False(t, exists)
	binding, exists := AgentCredentialByUUID(pair.UUID)
	require.True(t, exists)
	require.Zero(t, binding.VerifiedAt)
	require.NoError(t, DB.Callback().Update().Remove(callback))
	_, err = AuthenticateAgentCredential(pair.Secret, pair.UUID)
	require.NoError(t, err)
}
