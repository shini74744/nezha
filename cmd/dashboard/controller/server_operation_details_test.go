package controller

import (
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestOperationDetailsDoNotAffectFilteringOrCounts(t *testing.T) {
	_, cleanup := setupServerOwnershipFixture(t)
	defer cleanup()
	details := &model.ServerOperationDetails{
		IPSnapshot: []model.ServerOperationIPSnapshot{
			{Field: "ipv4", Before: "192.0.2.1", After: "192.0.2.2", Observed: true},
			{Field: "ipv6", Before: "2001:db8::1", After: "2001:db8::1", Observed: true},
		},
		PublicNote: &model.ServerOperationTextSnapshot{Before: "before", After: "after"},
	}
	row := model.ServerOperationLog{ServerUUID: "snapshot-node", Action: "inventory_change",
		Changes: []model.ServerOperationChange{{Field: "ipv4", Before: "192.0.2.1", After: "192.0.2.2"},
			{Field: "cpu", Before: "old", After: "new"}}, Details: details}
	require.NoError(t, singleton.DB.Create(&row).Error)
	page, err := listServerOperations(historyContext("uuid=snapshot-node&field=ip"))
	require.NoError(t, err)
	require.EqualValues(t, 1, page.Pagination.Total)
	require.Len(t, page.Value[0].Changes, 1)
	require.Len(t, page.Value[0].Details.IPSnapshot, 2)
	require.Nil(t, page.Value[0].Details.PublicNote)
	page, err = listServerOperations(historyContext("uuid=snapshot-node&field=cpu"))
	require.NoError(t, err)
	require.Len(t, page.Value[0].Changes, 1)
	require.Empty(t, page.Value[0].Details.IPSnapshot)
	require.Nil(t, page.Value[0].Details.PublicNote)
	page, err = listServerOperations(historyContext("uuid=snapshot-node"))
	require.NoError(t, err)
	require.Equal(t, details, page.Value[0].Details)
	// Filtering never mutates persisted snapshots.
	var saved model.ServerOperationLog
	require.NoError(t, singleton.DB.First(&saved, row.ID).Error)
	require.Equal(t, details, saved.Details)
}
