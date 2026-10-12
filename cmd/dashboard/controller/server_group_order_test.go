package controller

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
)

func groupOrderFixture(t *testing.T) {
	t.Helper()
	setupServerGroupVisibilityFixture(t)
	db := singleton.DB
	require.NoError(t, db.Exec("DELETE FROM server_group_servers").Error)
	require.NoError(t, db.Exec("DELETE FROM server_groups").Error)
	for i := uint64(1); i <= 4; i++ {
		require.NoError(t, db.Create(&model.ServerGroup{Common: model.Common{ID: i, UserID: 1}, Name: fmt.Sprint("group-", i)}).Error)
		for _, server := range []uint64{1, 2} {
			require.NoError(t, db.Create(&model.ServerGroupServer{ServerGroupId: i, ServerId: server}).Error)
		}
	}
}
func groupOrderContext(t *testing.T, method, path string, body any) *gin.Context {
	t.Helper()
	raw, err := json.Marshal(body)
	require.NoError(t, err)
	c := newServerGroupCtx(&model.User{Common: model.Common{ID: 1}, Role: model.RoleAdmin})
	c.Request = httptest.NewRequest(method, path, bytes.NewReader(raw))
	c.Request.Header.Set("Content-Type", "application/json")
	return c
}
func groupOrderDeleteContext(t *testing.T, ids []uint64) *gin.Context {
	t.Helper()
	var groups []model.ServerGroup
	require.NoError(t, singleton.DB.Where("id IN ?", ids).Find(&groups).Error)
	revisions := map[uint64]string{}
	for _, group := range groups {
		revisions[group.ID] = model.ServerGroupRevision(group)
	}
	raw, err := json.Marshal(revisions)
	require.NoError(t, err)
	return groupOrderContext(t, "POST", "/api/v1/batch-delete/server-group?revisions="+url.QueryEscape(string(raw)), ids)
}

func TestServerGroupDeleteCompactsActualIDs(t *testing.T) {
	for _, tc := range []struct {
		name           string
		remove, remain []uint64
	}{
		{"first", []uint64{1}, []uint64{2, 3, 4}},
		{"middle", []uint64{2}, []uint64{1, 3, 4}},
		{"last", []uint64{4}, []uint64{1, 2, 3}},
		{"batch", []uint64{1, 3, 3}, []uint64{2, 4}},
		{"all", []uint64{1, 2, 3, 4}, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			groupOrderFixture(t)
			var before []model.Server
			require.NoError(t, singleton.DB.Order("id").Find(&before).Error)
			_, err := batchDeleteServerGroup(groupOrderDeleteContext(t, tc.remove))
			require.NoError(t, err)
			var groups []model.ServerGroup
			require.NoError(t, singleton.DB.Order("id").Find(&groups).Error)
			require.Len(t, groups, len(tc.remain))
			for index, old := range tc.remain {
				require.Equal(t, uint64(index+1), groups[index].ID)
				require.Equal(t, fmt.Sprint("group-", old), groups[index].Name)
				require.Equal(t, uint64(1), groups[index].UserID)
				var members []uint64
				require.NoError(t, singleton.DB.Model(&model.ServerGroupServer{}).Where("server_group_id = ?", index+1).Order("server_id").Pluck("server_id", &members).Error)
				require.Equal(t, []uint64{1, 2}, members)
			}
			var after []model.Server
			require.NoError(t, singleton.DB.Order("id").Find(&after).Error)
			require.Equal(t, before, after, "group compaction must never renumber servers")
			id, err := createServerGroup(groupOrderContext(t, "POST", "/api/v1/server-group", model.ServerGroupForm{Name: "new", Servers: []uint64{1}}))
			require.NoError(t, err)
			require.Equal(t, uint64(len(tc.remain)+1), id)
		})
	}
}

func TestServerGroupStaleDeleteAndEditCannotTouchReusedID(t *testing.T) {
	groupOrderFixture(t)
	staleDelete := groupOrderDeleteContext(t, []uint64{1})
	var old model.ServerGroup
	require.NoError(t, singleton.DB.First(&old, 1).Error)
	_, err := batchDeleteServerGroup(groupOrderDeleteContext(t, []uint64{1}))
	require.NoError(t, err)
	_, err = batchDeleteServerGroup(staleDelete)
	require.ErrorContains(t, err, "刷新")
	edit := groupOrderContext(t, "PATCH", "/api/v1/server-group/1", model.ServerGroupForm{Name: "WRONG", Servers: []uint64{1}, Revision: model.ServerGroupRevision(old)})
	edit.Params = gin.Params{{Key: "id", Value: "1"}}
	_, err = updateServerGroup(edit)
	require.ErrorContains(t, err, "刷新")
	var current model.ServerGroup
	require.NoError(t, singleton.DB.First(&current, 1).Error)
	require.Equal(t, "group-2", current.Name)
	edit = groupOrderContext(t, "PATCH", "/api/v1/server-group/1", model.ServerGroupForm{Name: "correct", Servers: []uint64{2}, Revision: model.ServerGroupRevision(current)})
	edit.Params = gin.Params{{Key: "id", Value: "1"}}
	_, err = updateServerGroup(edit)
	require.NoError(t, err)
	require.NoError(t, singleton.DB.First(&current, 1).Error)
	require.Equal(t, "correct", current.Name)
}

func TestServerGroupDeleteRollbackAndMissingRevision(t *testing.T) {
	groupOrderFixture(t)
	_, err := batchDeleteServerGroup(groupOrderContext(t, "POST", "/api/v1/batch-delete/server-group", []uint64{1}))
	require.ErrorContains(t, err, "刷新")
	var groups []model.ServerGroup
	var members []model.ServerGroupServer
	require.NoError(t, singleton.DB.Order("id").Find(&groups).Error)
	require.NoError(t, singleton.DB.Order("id").Find(&members).Error)
	require.NoError(t, singleton.DB.Exec("CREATE TRIGGER fail_group_move BEFORE UPDATE OF server_group_id ON server_group_servers BEGIN SELECT RAISE(ABORT, 'fixture rollback'); END").Error)
	_, err = batchDeleteServerGroup(groupOrderDeleteContext(t, []uint64{1}))
	require.Error(t, err)
	var gotGroups []model.ServerGroup
	var gotMembers []model.ServerGroupServer
	require.NoError(t, singleton.DB.Order("id").Find(&gotGroups).Error)
	require.NoError(t, singleton.DB.Order("id").Find(&gotMembers).Error)
	require.Equal(t, groups, gotGroups)
	require.Equal(t, members, gotMembers)
	var logs int64
	require.NoError(t, singleton.DB.Model(&model.ServerOperationLog{}).Count(&logs).Error)
	require.Zero(t, logs)
}

func TestServerGroupLegacyCompactionPreservesHistory(t *testing.T) {
	setupServerGroupVisibilityFixture(t)
	db := singleton.DB
	old := model.ServerOperationLog{ServerID: 1, ServerUUID: "public", Action: "group", Changes: []model.ServerOperationChange{{Field: "groups", Before: "#9 old", After: "#10 Public Group"}}}
	require.NoError(t, db.Create(&old).Error)
	require.NoError(t, model.WithServerOperation(db, model.ServerOperationActor{}, "group", nil, model.CompactServerGroupIDs))
	var groups []model.ServerGroup
	require.NoError(t, db.Order("id").Find(&groups).Error)
	require.Equal(t, uint64(1), groups[0].ID)
	require.Equal(t, uint64(2), groups[1].ID)
	var member model.ServerGroupServer
	require.NoError(t, db.First(&member).Error)
	require.Equal(t, uint64(1), member.ServerGroupId)
	var historical model.ServerOperationLog
	require.NoError(t, db.First(&historical, old.ID).Error)
	require.Equal(t, old.Changes, historical.Changes)
	var logs []model.ServerOperationLog
	require.NoError(t, db.Order("id").Find(&logs).Error)
	require.Len(t, logs, 2)
	require.Equal(t, "#10 Public Group", logs[1].Changes[0].Before)
	require.Equal(t, "#1 Public Group", logs[1].Changes[0].After)
	require.NoError(t, db.Transaction(model.CompactServerGroupIDs))
	var count int64
	require.NoError(t, db.Model(&model.ServerOperationLog{}).Count(&count).Error)
	require.Equal(t, int64(2), count)
}

func TestServerGroupCompactionRejectsOrphanWithoutPartialWrites(t *testing.T) {
	setupServerGroupVisibilityFixture(t)
	require.NoError(t, singleton.DB.Create(&model.ServerGroupServer{ServerGroupId: 1, ServerId: 1}).Error)
	err := singleton.DB.Transaction(func(tx *gorm.DB) error { return model.CompactServerGroupIDs(tx) })
	require.ErrorContains(t, err, "orphan")
	var group model.ServerGroup
	require.NoError(t, singleton.DB.First(&group, 10).Error)
}

func TestServerGroupConcurrentRepeatedDeleteDoesNotDeleteNextGroup(t *testing.T) {
	groupOrderFixture(t)
	first, second := groupOrderDeleteContext(t, []uint64{1}), groupOrderDeleteContext(t, []uint64{1})
	results := make(chan error, 2)
	for _, ctx := range []*gin.Context{first, second} {
		go func(c *gin.Context) { _, err := batchDeleteServerGroup(c); results <- err }(ctx)
	}
	succeeded := 0
	for i := 0; i < 2; i++ {
		if err := <-results; err == nil {
			succeeded++
		} else {
			require.ErrorContains(t, err, "刷新")
		}
	}
	require.Equal(t, 1, succeeded)
	var groups []model.ServerGroup
	require.NoError(t, singleton.DB.Order("id").Find(&groups).Error)
	require.Len(t, groups, 3)
	require.Equal(t, "group-2", groups[0].Name)
}
