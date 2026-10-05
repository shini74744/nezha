package singleton

import (
	"testing"

	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
)

func TestIdentityRejectionGroupsByIPAndReason(t *testing.T) {
	setupPermanentDeleteTest(t)
	require.NoError(t, DB.AutoMigrate(&model.AgentIdentityRejection{}))
	RecordAgentIdentityRejection("invalid-one", "2001:0db8::1")
	RecordAgentIdentityRejection("invalid-two", "2001:db8::1")
	RecordAgentIdentityRejection("", "2001:db8::1")
	RecordAgentIdentityRejection(" ", "2001:db8::2")
	RecordAgentIdentityRejection("00000000-0000-0000-0000-000000000001", "2001:db8::1")
	var rows []model.AgentIdentityRejection
	require.NoError(t, DB.Order("ip,reason").Find(&rows).Error)
	require.Len(t, rows, 3)
	var invalid model.AgentIdentityRejection
	require.NoError(t, DB.First(&invalid, "ip = ? AND reason = ?", "2001:db8::1", model.AgentIdentityUUIDInvalid).Error)
	require.EqualValues(t, 2, invalid.ReportCount)
	// The persisted schema contains no raw input or credential column.
	var columns []struct{ Name string }
	require.NoError(t, DB.Raw("PRAGMA table_info(agent_identity_rejections)").Scan(&columns).Error)
	names := make([]string, 0, len(columns))
	for _, column := range columns {
		names = append(names, column.Name)
	}
	require.ElementsMatch(t, []string{"ip", "reason", "first_report_at", "last_report_at", "report_count"}, names)
}

func TestIdentityRejectionCapPreservesExistingCounters(t *testing.T) {
	setupPermanentDeleteTest(t)
	require.NoError(t, DB.AutoMigrate(&model.AgentIdentityRejection{}))
	require.NoError(t, DB.Exec(`WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<10000)
        INSERT INTO agent_identity_rejections (ip,reason,first_report_at,last_report_at,report_count)
        SELECT printf('2001:db8::%x',n),'uuid_invalid',1,1,1 FROM numbers`).Error)
	RecordAgentIdentityRejection("bad", "2001:db8::1")
	RecordAgentIdentityRejection("", "2001:db8::1")
	RecordAgentIdentityRejection("bad", "192.0.2.62")
	var count int64
	require.NoError(t, DB.Model(&model.AgentIdentityRejection{}).Count(&count).Error)
	require.EqualValues(t, 10000, count)
	var row model.AgentIdentityRejection
	require.NoError(t, DB.First(&row, "ip = ? AND reason = ?", "2001:db8::1", model.AgentIdentityUUIDInvalid).Error)
	require.EqualValues(t, 2, row.ReportCount)
}
