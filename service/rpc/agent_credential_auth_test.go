package rpc

import (
	"context"
	"fmt"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/metadata"
	"path/filepath"
	"testing"
)

func enableCredentialAuthFixture(t *testing.T) {
	t.Helper()
	t.Cleanup(setupAuthHandshakeFixture(t))
	require.NoError(t, singleton.DB.AutoMigrate(&model.AgentCredential{}, &model.AgentCredentialRejection{}, &model.ServerDeletionTombstone{}))
	require.NoError(t, singleton.InitAgentCredentials(filepath.Join(t.TempDir(), "agent-credentials.key")))
}
func TestDedicatedCredentialAuthMigrationAndKeyFirst(t *testing.T) {
	enableCredentialAuthFixture(t)
	pair, err := singleton.IssueAgentCredential(authHandshakeUUID, 100, model.ServerOperationActor{ID: 100})
	require.NoError(t, err)
	id, err := authCheckWithSecret("alice-global", authHandshakeUUID)
	require.NoError(t, err)
	require.EqualValues(t, 11, id)
	_, err = authCheckWithSecret("unknown-key-with-enough-length", "bad-uuid")
	require.ErrorContains(t, err, "客户端认证失败")
	var blocked int64
	require.NoError(t, singleton.DB.Model(&model.WAF{}).Count(&blocked).Error)
	require.Zero(t, blocked)
	var rejected int64
	require.NoError(t, singleton.DB.Model(&model.AgentCredentialRejection{}).Count(&rejected).Error)
	require.EqualValues(t, 1, rejected)
	id, err = authCheckWithSecret(pair.Secret, pair.UUID)
	require.NoError(t, err)
	require.EqualValues(t, 11, id)
	_, err = authCheckWithSecret("alice-global", authHandshakeUUID)
	require.Error(t, err, "old shared key must stop after new key proves connection")
	_, err = authCheckWithSecret(pair.Secret, "22222222-2222-4222-8222-222222222222")
	require.Error(t, err, "key bound to one UUID")
	_, err = authCheckWithSecret("alice-global", "33333333-3333-4333-8333-333333333333")
	require.Error(t, err, "legacy shared key cannot register new servers")
}
func TestDedicatedCredentialNewRegistrationAndRevocation(t *testing.T) {
	enableCredentialAuthFixture(t)
	pair, err := singleton.IssueAgentCredential("", 100, model.ServerOperationActor{ID: 100})
	require.NoError(t, err)
	id, err := authCheckWithSecret(pair.Secret, pair.UUID)
	require.NoError(t, err)
	id2, err := authCheckWithSecret(pair.Secret, pair.UUID)
	require.NoError(t, err)
	require.Equal(t, id, id2)
	_, err = singleton.UnusedAgentCredentialPair(pair.UUID, pair.Version, 100, true, model.ServerOperationActor{ID: 100})
	require.Error(t, err)
}
func TestDedicatedCredentialTransferTemporaryRecoveryNeverPromoted(t *testing.T) {
	enableCredentialAuthFixture(t)
	pair, err := singleton.IssueAgentCredential(authHandshakeUUID, 100, model.ServerOperationActor{ID: 100})
	require.NoError(t, err)
	_, err = authCheckWithSecret(pair.Secret, pair.UUID)
	require.NoError(t, err)
	transfer, err := singleton.ServerTransferShared.InitiateExclusive(11, 100, 200, 100)
	require.NoError(t, err)
	_, err = authCheckWithSecret(pair.Secret, pair.UUID)
	require.NoError(t, err, "old dedicated key remains usable to receive transfer")
	_, err = singleton.ServerTransferShared.MarkFailed(transfer.ID, "fixture")
	require.NoError(t, err)
	_, err = authCheckWithSecret(transfer.HandshakeSecret, pair.UUID)
	require.NoError(t, err)
	binding, ok := singleton.AgentCredentialByUUID(pair.UUID)
	require.True(t, ok)
	require.Equal(t, singleton.AgentCredentialHash(pair.Secret), binding.SecretHash, "temporary forward-recovery secret must not persist")
	_, err = authCheckWithSecret(transfer.RevertHandshakeSecret, pair.UUID)
	require.NoError(t, err)
	binding, ok = singleton.AgentCredentialByUUID(pair.UUID)
	require.True(t, ok)
	require.Equal(t, singleton.AgentCredentialHash(transfer.RevertHandshakeSecret), binding.SecretHash)
}

func TestDedicatedCredentialReplacementOnlyPromotedAfterCleanup(t *testing.T) {
	enableCredentialAuthFixture(t)
	other, err := singleton.IssueAgentCredential("", 100, model.ServerOperationActor{ID: 100})
	require.NoError(t, err)
	otherID, err := authCheckWithSecret(other.Secret, other.UUID)
	require.NoError(t, err)
	pair, err := singleton.IssueAgentCredential(authHandshakeUUID, 100, model.ServerOperationActor{ID: 100})
	require.NoError(t, err)
	_, err = authCheckWithSecret(pair.Secret, pair.UUID)
	require.NoError(t, err)
	secret, _, err := singleton.IssueServerReplacement(pair.UUID, model.ServerOperationActor{ID: 100})
	require.NoError(t, err)
	_, err = authCheckWithSecret(secret, pair.UUID)
	require.NoError(t, err)
	binding, ok := singleton.AgentCredentialByUUID(pair.UUID)
	require.True(t, ok)
	require.Equal(t, singleton.AgentCredentialHash(pair.Secret), binding.SecretHash, "pending cleanup must not replace the stable binding")
	require.NoError(t, singleton.DB.AutoMigrate(&model.Transfer{}, &model.ServerSnapshot{}, &model.ServiceHistory{}, &model.ServerIPHistory{}, &model.PlanTrafficDay{}, &model.PlanTrafficCheckpoint{}, &model.AgentUUIDConflict{}))
	prepareFullReplacementSchema(t)
	_, err = singleton.CompleteServerReplacement(secret, pair.UUID, &model.Host{Platform: "ubuntu"}, &model.HostState{})
	require.NoError(t, err)
	_, err = authCheckWithSecret(secret, pair.UUID)
	require.NoError(t, err)
	binding, ok = singleton.AgentCredentialByUUID(pair.UUID)
	require.True(t, ok)
	require.Equal(t, singleton.AgentCredentialHash(secret), binding.SecretHash)
	require.NotEqual(t, pair.Secret, secret, "replacement must issue a fresh node-specific key")
	require.NotEqual(t, other.Secret, secret, "replacement must never reuse another node key")
	_, err = authCheckWithSecret(pair.Secret, pair.UUID)
	require.Error(t, err, "the replaced machine key must stop authenticating after cleanup commits")
	_, err = authCheckWithSecret(secret, other.UUID)
	require.Error(t, err, "replacement key cannot authenticate another UUID")
	unaffectedID, err := authCheckWithSecret(other.Secret, other.UUID)
	require.NoError(t, err)
	require.Equal(t, otherID, unaffectedID, "replacement must not rotate unrelated nodes")
	require.NoError(t, singleton.DB.Where("server_uuid = ?", pair.UUID).Delete(&model.ServerReplacement{}).Error)
	_, err = authCheckWithSecret(secret, pair.UUID)
	require.NoError(t, err, "stable credential survives retirement of one-time replacement metadata")
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs("client-secret", secret, "client-uuid", pair.UUID))
	pending, err := pendingReplacement(ctx)
	require.NoError(t, err)
	require.False(t, pending)
}

func TestDedicatedCredentialTransferPromotionAtomicOnStorageFailure(t *testing.T) {
	for _, revert := range []bool{false, true} {
		t.Run(fmt.Sprint("revert=", revert), func(t *testing.T) {
			enableCredentialAuthFixture(t)
			pair, err := singleton.IssueAgentCredential(authHandshakeUUID, 100, model.ServerOperationActor{ID: 100})
			require.NoError(t, err)
			_, err = authCheckWithSecret(pair.Secret, pair.UUID)
			require.NoError(t, err)
			transfer, err := singleton.ServerTransferShared.InitiateExclusive(11, 100, 200, 100)
			require.NoError(t, err)
			next := transfer.HandshakeSecret
			if revert {
				_, err = singleton.ServerTransferShared.MarkFailed(transfer.ID, "fixture")
				require.NoError(t, err)
				next = transfer.RevertHandshakeSecret
			}
			require.NoError(t, singleton.DB.Exec("CREATE TEMP TRIGGER fail_credential_promotion BEFORE INSERT ON agent_credentials BEGIN SELECT RAISE(FAIL, 'fixture storage failure'); END").Error)
			_, err = authCheckWithSecret(next, pair.UUID)
			require.Error(t, err)
			var persisted model.ServerTransfer
			require.NoError(t, singleton.DB.First(&persisted, transfer.ID).Error)
			require.Nil(t, persisted.AckedAt)
			if !revert {
				require.Equal(t, model.ServerTransferStatusPending, persisted.Status)
			}
			binding, ok := singleton.AgentCredentialByUUID(pair.UUID)
			require.True(t, ok)
			require.Equal(t, singleton.AgentCredentialHash(pair.Secret), binding.SecretHash)
			_, err = authCheckWithSecret(pair.Secret, pair.UUID)
			require.NoError(t, err, "failed storage must leave old credential usable")
			require.NoError(t, singleton.DB.Exec("DROP TRIGGER fail_credential_promotion").Error)
			_, err = authCheckWithSecret(next, pair.UUID)
			require.NoError(t, err, "a later reconnect must retry successfully")
			binding, _ = singleton.AgentCredentialByUUID(pair.UUID)
			require.Equal(t, singleton.AgentCredentialHash(next), binding.SecretHash)
			_, err = authCheckWithSecret(pair.Secret, pair.UUID)
			require.Error(t, err)
		})
	}
}

func TestDedicatedCredentialAdmissionCannotRaceLifecycle(t *testing.T) {
	for _, state := range []string{"replacement", "transfer", "recovery"} {
		t.Run(state, func(t *testing.T) {
			enableCredentialAuthFixture(t)
			pair, err := singleton.IssueAgentCredential(authHandshakeUUID, 100, model.ServerOperationActor{ID: 100})
			require.NoError(t, err)
			_, err = authCheckWithSecret(pair.Secret, pair.UUID)
			require.NoError(t, err)
			if state == "replacement" {
				_, _, err = singleton.IssueServerReplacement(pair.UUID, model.ServerOperationActor{ID: 100})
				require.NoError(t, err)
			} else {
				transfer, err := singleton.ServerTransferShared.InitiateExclusive(11, 100, 200, 100)
				require.NoError(t, err)
				if state == "recovery" {
					_, err = singleton.ServerTransferShared.MarkFailed(transfer.ID, "fixture")
					require.NoError(t, err)
				}
			}
			singleton.RecordRejectedAgentCredential(pair.UUID, "UnregisteredCandidate123456789012", "192.0.2.90")
			var report model.AgentCredentialRejection
			require.NoError(t, singleton.DB.First(&report).Error)
			_, err = singleton.AdmitAgentCredential(singleton.AgentCredentialAdmission{ReportID: report.ID, BindingVersion: pair.Version}, model.ServerOperationActor{ID: 100})
			require.Error(t, err)
			binding, _ := singleton.AgentCredentialByUUID(pair.UUID)
			require.Equal(t, singleton.AgentCredentialHash(pair.Secret), binding.SecretHash)
		})
	}
}
