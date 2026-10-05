package singleton

import (
	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestUnknownAgentReportsOnlyUpdateBlockedUUIDs(t *testing.T) {
	setupPermanentDeleteTest(t)
	uuid := "12345678-1234-1234-1234-123456789abc"
	require.NoError(t, DB.Create(&model.ServerDeletionTombstone{UUID: uuid, Name: "deleted fixture"}).Error)
	blockDeletedServerUUIDs([]string{uuid})
	RecordDeletedAgentReport(uuid, "192.0.2.1")
	var first model.ServerDeletionTombstone
	require.NoError(t, DB.First(&first, "uuid = ?", uuid).Error)
	require.EqualValues(t, 1, first.ReportCount)
	require.Positive(t, first.FirstReportAt)
	RecordDeletedAgentReport(uuid, "2001:db8::1")
	var latest model.ServerDeletionTombstone
	require.NoError(t, DB.First(&latest, "uuid = ?", uuid).Error)
	require.EqualValues(t, 2, latest.ReportCount)
	require.Equal(t, first.FirstReportAt, latest.FirstReportAt)
	require.Equal(t, "2001:db8::1", latest.LastIP)
	RecordDeletedAgentReport("unregistered-attacker-uuid", "invalid-IP")
	var count int64
	require.NoError(t, DB.Model(&model.ServerDeletionTombstone{}).Count(&count).Error)
	require.EqualValues(t, 1, count)
	require.NoError(t, initDeletedServerUUIDs())
	require.True(t, IsDeletedServerUUID(uuid), "blacklist survives reload")
}

func TestPermanentDeletionRejectsReusedIdentityOrChangedOwner(t *testing.T) {
	setupPermanentDeleteTest(t)
	server := model.Server{Common: model.Common{ID: 11, UserID: 8}, UUID: "new-uuid", Name: "replacement"}
	require.NoError(t, DB.Create(&server).Error)
	for _, identity := range []ServerDeleteIdentity{{UUID: "old-uuid", UserID: 8}, {UUID: "new-uuid", UserID: 9}} {
		err := PermanentlyDeleteServersMatching([]uint64{11}, map[uint64]ServerDeleteIdentity{11: identity})
		require.Error(t, err)
		require.False(t, IsDeletedServerUUID(server.UUID))
		var count int64
		require.NoError(t, DB.Model(&model.Server{}).Where("id = ?", 11).Count(&count).Error)
		require.EqualValues(t, 1, count)
	}
}
