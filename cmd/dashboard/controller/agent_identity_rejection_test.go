package controller

import (
	"testing"

	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
)

func TestAuthFirewallIncludesIdentityRejectionsWithoutNodeIdentity(t *testing.T) {
	_, cleanup := setupServerOwnershipFixture(t)
	defer cleanup()
	require.NoError(t, singleton.DB.AutoMigrate(&model.ServerDeletionTombstone{}, &model.UnknownAgentReport{}, &model.AgentUUIDConflict{}, &model.AgentIdentityRejection{}))
	require.NoError(t, singleton.DB.Create(&[]model.AgentIdentityRejection{
		{IP: "192.0.2.61", Reason: model.AgentIdentityUUIDMissing, FirstReportAt: 5, LastReportAt: 10, ReportCount: 3},
		{IP: "192.0.2.60", Reason: model.AgentIdentityUUIDMissing, FirstReportAt: 5, LastReportAt: 10, ReportCount: 2},
		{IP: "192.0.2.60", Reason: model.AgentIdentityUUIDInvalid, FirstReportAt: 5, LastReportAt: 10, ReportCount: 4},
	}).Error)
	first, err := listUnknownAgentReports(historyContext("offset=0&limit=2"))
	require.NoError(t, err)
	require.EqualValues(t, 3, first.Pagination.Total)
	require.Len(t, first.Value, 2)
	require.Equal(t, model.AgentIdentityUUIDInvalid, first.Value[0].Kind)
	require.Equal(t, model.AgentIdentityUUIDMissing, first.Value[1].Kind)
	require.Equal(t, "192.0.2.60", first.Value[1].LastIP)
	next, err := listUnknownAgentReports(historyContext("offset=2&limit=2"))
	require.NoError(t, err)
	require.Len(t, next.Value, 1)
	require.Equal(t, "192.0.2.61", next.Value[0].LastIP)
	for _, row := range append(first.Value, next.Value...) {
		require.Empty(t, row.UUID)
		require.Equal(t, "未识别节点", row.Name)
	}
	deleted, err := listDeletedServers(historyContext(""))
	require.NoError(t, err)
	require.Empty(t, deleted.Value, "invalid UUID must not be classified as a deleted node")
}
