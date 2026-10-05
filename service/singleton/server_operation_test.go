package singleton

import (
	"testing"

	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
)

func TestDeletionKeepsActorOriginalIDAndOperationHistory(t *testing.T) {
	setupPermanentDeleteTest(t)
	server := &model.Server{Common: model.Common{ID: 11, UserID: 1}, Name: "before-delete", UUID: "aaaaaaaa-1234-1234-1234-123456789abc"}
	require.NoError(t, DB.Create(server).Error)
	model.InitServer(server)
	ServerShared.Update(server, server.UUID)
	require.NoError(t, model.RecordServerOperation(DB, model.ServerOperationActor{Name: "Agent", Source: "agent"}, "create", nil, server))
	require.NoError(t, PermanentlyDeleteServersMatching([]uint64{11}, nil, model.ServerOperationActor{ID: 7, Name: "admin", Source: "web"}))
	var deleted model.ServerDeletionTombstone
	require.NoError(t, DB.First(&deleted, "uuid = ?", server.UUID).Error)
	require.EqualValues(t, 11, deleted.OriginalID)
	require.EqualValues(t, 7, deleted.DeletedByID)
	require.Equal(t, "admin", deleted.DeletedByName)
	require.Zero(t, deleted.ReportCount, "deletion is visible even without reconnect")
	require.NoError(t, DB.Create(&model.Server{Common: model.Common{ID: 11}, Name: "replacement", UUID: "different"}).Error)
	var rows []model.ServerOperationLog
	require.NoError(t, DB.Order("id").Find(&rows).Error)
	require.Len(t, rows, 2)
	require.Equal(t, "delete", rows[1].Action)
	require.Equal(t, server.UUID, rows[1].ServerUUID)
	require.Equal(t, "admin", rows[1].ActorName)
	RecordDeletedAgentReport(server.UUID, "192.0.2.50")
	require.NoError(t, DB.First(&deleted, "uuid = ?", server.UUID).Error)
	require.EqualValues(t, 1, deleted.ReportCount)
	require.EqualValues(t, 11, deleted.OriginalID, "later reports must not overwrite deletion metadata")
}

func TestUnregisteredReportCapStillUpdatesKnownReports(t *testing.T) {
	setupPermanentDeleteTest(t)
	require.NoError(t, DB.Exec(`WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<10000)
        INSERT INTO unknown_agent_reports (uuid,last_ip,first_report_at,last_report_at,report_count)
        SELECT printf('00000000-0000-0000-0000-%012d',n),'192.0.2.1',1,1,1 FROM numbers`).Error)
	RecordAgentAuthFailure("00000000-0000-0000-0000-000000010001", "192.0.2.51")
	RecordAgentAuthFailure("00000000-0000-0000-0000-000000000001", "192.0.2.52")
	var count int64
	require.NoError(t, DB.Model(&model.UnknownAgentReport{}).Count(&count).Error)
	require.EqualValues(t, 10000, count)
	var row model.UnknownAgentReport
	require.NoError(t, DB.First(&row, "uuid = ?", "00000000-0000-0000-0000-000000000001").Error)
	require.EqualValues(t, 2, row.ReportCount)
	require.Equal(t, "192.0.2.52", row.LastIP)
}
