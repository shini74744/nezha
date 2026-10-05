package rpc

import (
	"context"
	"testing"

	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func TestDeletedAgentReconnectIsRecordedAndNotRegistered(t *testing.T) {
	defer setupAuthHandshakeFixture(t)()
	require.NoError(t, singleton.DB.AutoMigrate(
		&model.ServerDeletionTombstone{}, &model.ServerGroupServer{}, &model.Transfer{},
		&model.NAT{}, &model.MCPAuditLog{}, &model.Cron{}, &model.Service{}, &model.AlertRule{}, &model.APIToken{},
	))
	const removedUUID = "aabbccdd-1234-1234-1234-123456789abc"
	removed := &model.Server{Common: model.Common{ID: 12, UserID: 100}, UUID: removedUUID, Name: "deleted-offline-fixture"}
	require.NoError(t, singleton.DB.Create(removed).Error)
	model.InitServer(removed)
	singleton.ServerShared.Update(removed, removedUUID)
	require.NoError(t, singleton.PermanentlyDeleteServers([]uint64{12}))
	ctx := context.WithValue(context.Background(), model.CtxKeyRealIP{}, "192.0.2.20")
	ctx = metadata.NewIncomingContext(ctx, metadata.Pairs("client-secret", "alice-global", "client-uuid", removedUUID))
	for i := 0; i < 2; i++ {
		id, err := (&authHandler{}).Check(ctx)
		require.Zero(t, id)
		require.Equal(t, codes.Unauthenticated, status.Code(err))
	}
	var tombstone model.ServerDeletionTombstone
	require.NoError(t, singleton.DB.First(&tombstone, "uuid = ?", removedUUID).Error)
	require.EqualValues(t, 2, tombstone.ReportCount)
	require.Equal(t, "192.0.2.20", tombstone.LastIP)
	require.Equal(t, "deleted-offline-fixture", tombstone.Name)
	var count int64
	require.NoError(t, singleton.DB.Model(&model.Server{}).Where("uuid = ?", removedUUID).Count(&count).Error)
	require.Zero(t, count)
	// A valid new UUID on the same account remains eligible for registration.
	id, err := authCheckWithHyphenatedSecret("alice-global", "bbbbcccc-1234-1234-1234-123456789abc")
	require.NoError(t, err)
	require.NotZero(t, id)
	var blocks int64
	require.NoError(t, singleton.DB.Model(&model.WAF{}).Count(&blocks).Error)
	require.Zero(t, blocks, "deleted UUID must not block every node sharing its IP")
}
