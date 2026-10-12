package controller

import (
	"crypto/sha256"
	"fmt"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/connectivity"
	"github.com/nezhahq/nezha/service/networkinsight"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestReplacementDetectionCleanupIsUUIDScoped(t *testing.T) {
	_, cleanup := setupServerOwnershipFixture(t)
	defer cleanup()
	db := singleton.DB
	require.NoError(t, db.AutoMigrate(&model.ServerIPHistory{}, &connectivity.Record{}, &networkinsight.Record{}))
	server := &model.Server{Common: model.Common{ID: 7, UserID: 1}, UUID: "replace-target"}
	key := connectivityKey(server)
	legacyIdentity := fmt.Sprintf("%x", sha256.Sum256([]byte(key+"::")))
	for _, r := range []connectivity.Record{
		{ServerUUID: server.UUID, Identity: "old-key", FinishedAt: 1},
		{Identity: key, FinishedAt: 2},
		{ServerUUID: "other", Identity: "other-key", FinishedAt: 3},
	} {
		require.NoError(t, db.Create(&r).Error)
	}
	for _, r := range []networkinsight.Record{
		{ServerUUID: server.UUID, Identity: "old-hash"},
		{Identity: legacyIdentity},
		{ServerUUID: "other", Identity: "other-hash"},
	} {
		require.NoError(t, db.Create(&r).Error)
	}
	reset, err := clearReplacedDetectionData(db, server)
	require.NoError(t, err)
	reset()
	var conn []connectivity.Record
	require.NoError(t, db.Find(&conn).Error)
	require.Len(t, conn, 1)
	require.Equal(t, "other", conn[0].ServerUUID)
	var insight []networkinsight.Record
	require.NoError(t, db.Find(&insight).Error)
	require.Len(t, insight, 1)
	require.Equal(t, "other", insight[0].ServerUUID)
}
