package rpc

import (
	"context"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/metadata"
	"testing"
)

func TestReplacementHandshakeSurvivesProxyConnectionSplitting(t *testing.T) {
	server := &model.Server{Common: model.Common{ID: 7, UserID: 1}, UUID: "11111111-1111-4111-8111-111111111111"}
	setupApplyConfigAuthzFixture(t, []*model.Server{server}, map[uint64]model.UserInfo{1: {Role: model.RoleAdmin}}, map[string]uint64{"fixture": 1})
	secret, _, err := singleton.IssueServerReplacement(server.UUID, model.ServerOperationActor{ID: 1})
	require.NoError(t, err)
	ctx := func(s string) context.Context {
		return metadata.NewIncomingContext(context.Background(), metadata.Pairs("client-secret", s, "client-uuid", server.UUID))
	}
	first, err := replacementSession(ctx(secret))
	require.NoError(t, err)
	second, err := replacementSession(ctx(secret))
	require.NoError(t, err)
	require.Same(t, first, second)
	_, err = replacementSession(ctx("nzreplace_invalid"))
	require.Error(t, err)
	newer, _, err := singleton.IssueServerReplacement(server.UUID, model.ServerOperationActor{ID: 1})
	require.NoError(t, err)
	next, err := replacementSession(ctx(newer))
	require.NoError(t, err)
	require.NotSame(t, first, next)
	_, err = replacementSession(ctx(secret))
	require.Error(t, err)
}
