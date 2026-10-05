package rpc

import (
	"testing"

	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/utils"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const unregisteredAuthUUID = "aaaaaaaa-1234-1234-1234-123456789abc"

func readAgentWAF(t *testing.T, ip string) model.WAF {
	t.Helper()
	binary, err := utils.IPStringToBinary(ip)
	require.NoError(t, err)
	var record model.WAF
	require.NoError(t, singleton.DB.Where("ip = ? AND block_identifier = ?", binary, model.BlockIDgRPC).First(&record).Error)
	return record
}

func TestAuthWAFReasonsClassifyReportedUUID(t *testing.T) {
	cases := []struct {
		name, secret, uuid string
		reason             uint8
	}{
		{"registered UUID with rejected secret", "rejected-secret", authHandshakeUUID, model.WAFBlockReasonTypeAgentSecretInvalid},
		{"unregistered UUID with rejected secret", "rejected-secret", unregisteredAuthUUID, model.WAFBlockReasonTypeAgentUnknownCredential},
		{"malformed UUID with rejected secret", "rejected-secret", "not-a-uuid", model.WAFBlockReasonTypeAgentUUIDInvalid},
		{"missing UUID with rejected secret", "rejected-secret", "", model.WAFBlockReasonTypeAgentUUIDInvalid},
		{"malformed UUID with valid secret", "alice-global", "not-a-uuid", model.WAFBlockReasonTypeAgentUUIDInvalid},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			defer setupAuthHandshakeFixture(t)()
			for i := uint64(1); i <= 2; i++ {
				id, err := authCheckFromIP(tc.secret, tc.uuid, "192.0.2.31")
				require.Zero(t, id)
				require.Equal(t, codes.Unauthenticated, status.Code(err))
				record := readAgentWAF(t, "192.0.2.31")
				require.Equal(t, tc.reason, record.BlockReason)
				require.Equal(t, i, record.Count)
				require.NotZero(t, record.BlockTimestamp)
				require.EqualValues(t, model.BlockIDgRPC, record.BlockIdentifier)
				if tc.reason != model.WAFBlockReasonTypeAgentUUIDInvalid {
					require.Equal(t, "客户端认证失败", status.Convert(err).Message(), "do not reveal registered UUIDs to unauthenticated clients")
				}
			}
			var count int64
			require.NoError(t, singleton.DB.Model(&model.Server{}).Count(&count).Error)
			require.EqualValues(t, 1, count, "rejected credentials must not register a server")
		})
	}
}

func TestAuthWAFLatestReasonPreservesLegacyCountAndValidAuth(t *testing.T) {
	defer setupAuthHandshakeFixture(t)()
	const ip = "192.0.2.32"
	require.EqualValues(t, 3, model.WAFBlockReasonTypeAgentAuthFail)
	require.EqualValues(t, 5, model.WAFBlockReasonTypeBruteForceOauth2)
	require.EqualValues(t, 6, model.WAFBlockReasonTypeAgentSecretInvalid)
	require.EqualValues(t, 7, model.WAFBlockReasonTypeAgentUUIDInvalid)
	require.EqualValues(t, 8, model.WAFBlockReasonTypeAgentUnknownCredential)
	require.NoError(t, model.BlockIP(singleton.DB, ip, model.WAFBlockReasonTypeAgentAuthFail, model.BlockIDgRPC))
	// The persisted legacy reason is retained until another failure occurs.
	require.Equal(t, model.WAFBlockReasonTypeAgentAuthFail, readAgentWAF(t, ip).BlockReason)
	for i, uuid := range []string{authHandshakeUUID, "malformed", unregisteredAuthUUID} {
		_, err := authCheckFromIP("rejected-secret", uuid, ip)
		require.Error(t, err)
		record := readAgentWAF(t, ip)
		require.EqualValues(t, 6+i, record.BlockReason)
		require.EqualValues(t, 2+i, record.Count)
	}
	id, err := authCheckFromIP("alice-global", authHandshakeUUID, ip)
	require.NoError(t, err)
	require.EqualValues(t, 11, id)
	require.Zero(t, wafAgentAuthFailCount(t, ip), "valid auth keeps the existing unblock behavior")
}

func TestAuthWAFAllowsNewUUIDWithValidSecret(t *testing.T) {
	defer setupAuthHandshakeFixture(t)()
	const ip = "192.0.2.33"
	id, err := authCheckFromIP("alice-global", unregisteredAuthUUID, ip)
	require.NoError(t, err)
	require.NotZero(t, id)
	require.Zero(t, wafAgentAuthFailCount(t, ip))
	// A newly registered UUID must use the registered category on subsequent failure.
	_, err = authCheckFromIP("rejected-secret", unregisteredAuthUUID, ip)
	require.Error(t, err)
	require.Equal(t, model.WAFBlockReasonTypeAgentSecretInvalid, readAgentWAF(t, ip).BlockReason)
}

func TestUnknownReportsIncludeAuthFailuresButExcludeSuccessfulNewAgents(t *testing.T) {
	defer setupAuthHandshakeFixture(t)()
	// Missing and invalid secrets for an unregistered UUID are both rejected attempts.
	for _, secret := range []string{"", "rejected-secret"} {
		_, err := authCheckFromIP(secret, unregisteredAuthUUID, "192.0.2.40")
		require.Error(t, err)
	}
	var row model.UnknownAgentReport
	require.NoError(t, singleton.DB.First(&row, "uuid = ?", unregisteredAuthUUID).Error)
	require.EqualValues(t, 2, row.ReportCount)
	require.Equal(t, "192.0.2.40", row.LastIP)
	// Registered UUID failures are also recorded, without creating a new node.
	for _, secret := range []string{"", "rejected-secret"} {
		_, err := authCheckFromIP(secret, authHandshakeUUID, "192.0.2.41")
		require.Error(t, err)
	}
	var count int64
	require.NoError(t, singleton.DB.Model(&model.UnknownAgentReport{}).Where("uuid = ?", authHandshakeUUID).Count(&count).Error)
	require.EqualValues(t, 1, count)
	row = model.UnknownAgentReport{}
	require.NoError(t, singleton.DB.First(&row, "uuid = ?", authHandshakeUUID).Error)
	require.EqualValues(t, 2, row.ReportCount)
	// Successful existing authentication does not add a failure.
	_, err := authCheckFromIP("alice-global", authHandshakeUUID, "192.0.2.41")
	require.NoError(t, err)
	require.NoError(t, singleton.DB.First(&row, "uuid = ?", authHandshakeUUID).Error)
	require.EqualValues(t, 2, row.ReportCount)
	// The same previously unknown UUID can still legitimately register with a valid key.
	id, err := authCheckFromIP("alice-global", unregisteredAuthUUID, "192.0.2.40")
	require.NoError(t, err)
	require.NotZero(t, id)
	const freshUUID = "cccccccc-1234-1234-1234-123456789abc"
	_, err = authCheckFromIP("alice-global", freshUUID, "192.0.2.42")
	require.NoError(t, err)
	require.NoError(t, singleton.DB.Model(&model.UnknownAgentReport{}).Where("uuid = ?", freshUUID).Count(&count).Error)
	require.Zero(t, count)
}
