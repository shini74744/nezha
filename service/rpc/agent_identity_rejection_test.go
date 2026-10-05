package rpc

import (
	"context"
	"strings"
	"testing"

	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestAuthRecordsMissingAndMalformedUUIDRegardlessOfSecret(t *testing.T) {
	for _, tc := range []struct{ name, uuid, reason string }{
		{"missing", "", model.AgentIdentityUUIDMissing},
		{"whitespace", "   ", model.AgentIdentityUUIDMissing},
		{"malformed", "not-a-uuid", model.AgentIdentityUUIDInvalid},
		{"untrusted markup", "<script>secret-value</script>", model.AgentIdentityUUIDInvalid},
		{"oversized", strings.Repeat("x", 65536), model.AgentIdentityUUIDInvalid},
	} {
		for _, secret := range []string{"", "rejected-secret", "alice-global"} {
			t.Run(tc.name+"/"+secret, func(t *testing.T) {
				defer setupAuthHandshakeFixture(t)()
				const ip = "192.0.2.60"
				for i := uint64(1); i <= 2; i++ {
					id, err := authCheckFromIP(secret, tc.uuid, ip)
					require.Zero(t, id)
					require.Equal(t, codes.Unauthenticated, status.Code(err))
					var row model.AgentIdentityRejection
					require.NoError(t, singleton.DB.First(&row, "ip = ? AND reason = ?", ip, tc.reason).Error)
					require.Equal(t, i, row.ReportCount)
					require.Greater(t, row.FirstReportAt, int64(0))
					require.GreaterOrEqual(t, row.LastReportAt, row.FirstReportAt)
				}
				var nodes, unknown int64
				require.NoError(t, singleton.DB.Model(&model.Server{}).Count(&nodes).Error)
				require.EqualValues(t, 1, nodes, "rejection cannot register a node")
				require.NoError(t, singleton.DB.Model(&model.UnknownAgentReport{}).Count(&unknown).Error)
				require.Zero(t, unknown, "malformed identities cannot enter UUID inventory")
				if secret == "" {
					require.Zero(t, wafAgentAuthFailCount(t, ip), "preserve existing missing-secret WAF semantics")
				} else {
					require.EqualValues(t, 2, readAgentWAF(t, ip).Count)
					require.Equal(t, model.WAFBlockReasonTypeAgentUUIDInvalid, readAgentWAF(t, ip).BlockReason)
				}
			})
		}
	}
}

func TestAuthRecordsMissingMetadataAndNormalUUIDIsNotIdentityRejection(t *testing.T) {
	defer setupAuthHandshakeFixture(t)()
	ctx := context.WithValue(context.Background(), model.CtxKeyRealIP{}, "2001:0db8::60")
	_, err := (&authHandler{}).Check(ctx)
	require.Equal(t, codes.Unauthenticated, status.Code(err))
	var rows []model.AgentIdentityRejection
	require.NoError(t, singleton.DB.Find(&rows).Error)
	require.Len(t, rows, 1)
	require.Equal(t, "2001:db8::60", rows[0].IP)
	require.Equal(t, model.AgentIdentityUUIDMissing, rows[0].Reason)
	for _, secret := range []string{"", "rejected-secret", "alice-global"} {
		_, _ = authCheckFromIP(secret, authHandshakeUUID, "192.0.2.61")
	}
	_, err = authCheckFromIP("alice-global", unregisteredAuthUUID, "192.0.2.62")
	require.NoError(t, err)
	var count int64
	require.NoError(t, singleton.DB.Model(&model.AgentIdentityRejection{}).Count(&count).Error)
	require.EqualValues(t, 1, count, "valid UUIDs use existing categories or register normally")
}
