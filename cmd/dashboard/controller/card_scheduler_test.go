package controller

import (
	"encoding/json"
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/networkinsight"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCardSchedulerPriorityAndPerNodeSerialization(t *testing.T) {
	a, b := &model.Server{Common: model.Common{ID: 1}}, &model.Server{Common: model.Common{ID: 2}}
	items := []cardCandidate{{a, "bgp", "", 100, 0}, {a, "connectivity", "", 100, 0}, {b, "bgp", "", 100, 0}, {b, "connectivity", "", 100, 0}, {a, "return-route", "", 100, 0}}
	order := []string{"connectivity", "return-route", "bgp", "streaming"}
	var got []string
	run := func(v cardCandidate) error { got = append(got, v.kind); return nil }
	require.Equal(t, 2, dispatchCardCandidates(items, order, func(cardCandidate) bool { return false }, run))
	require.Equal(t, []string{"connectivity", "connectivity"}, got)
	got = nil
	remaining := []cardCandidate{{a, "bgp", "", 100, 0}, {a, "return-route", "", 100, 0}}
	dispatchCardCandidates(remaining, order, func(cardCandidate) bool { return false }, run)
	require.Equal(t, []string{"return-route"}, got)
	got = nil
	dispatchCardCandidates(items, order, func(v cardCandidate) bool { return v.server.ID == 1 }, run)
	require.Equal(t, []string{"connectivity"}, got)
	got = nil
	dispatchCardCandidates(remaining, order, func(cardCandidate) bool { return false }, func(v cardCandidate) error { got = append(got, v.kind); return errors.New("capacity") })
	require.Equal(t, []string{"return-route"}, got, "lower priority must not overtake a blocked due task")
}
func TestCardSchedulerBoundedAndDeterministic(t *testing.T) {
	var items []cardCandidate
	for _, id := range []uint64{8, 4, 1, 9, 2} {
		items = append(items, cardCandidate{server: &model.Server{Common: model.Common{ID: id}}, kind: "bgp", slot: 100})
	}
	var got []uint64
	require.Equal(t, 3, dispatchCardCandidates(items, []string{"bgp"}, func(cardCandidate) bool { return false }, func(v cardCandidate) error { got = append(got, v.server.ID); return nil }))
	require.Equal(t, []uint64{1, 2, 4}, got)
}
func TestDetectionPriorityRevisionValidationAndPersistence(t *testing.T) {
	setupInsight(t)
	require.NoError(t, singleton.DB.AutoMigrate(&networkinsight.DetectionPriority{}))
	ctx := func(body string) *gin.Context {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPut, "/", strings.NewReader(body))
		return c
	}
	before, err := getDetectionPriority(ctx(""))
	require.NoError(t, err)
	require.Equal(t, networkinsight.DefaultDetectionPriority().Order, before.Order)
	before.Order = []string{"return-route", "bgp", "connectivity", "streaming"}
	raw, _ := json.Marshal(before)
	after, err := updateDetectionPriority(ctx(string(raw)))
	require.NoError(t, err)
	require.NotEqual(t, before.Revision, after.Revision)
	_, err = updateDetectionPriority(ctx(string(raw)))
	require.ErrorContains(t, err, "其他页面")
	for _, order := range [][]string{{"bgp"}, {"bgp", "bgp", "connectivity", "streaming"}, {"unknown", "bgp", "connectivity", "streaming"}} {
		after.Order = order
		raw, _ = json.Marshal(after)
		_, err = updateDetectionPriority(ctx(string(raw)))
		require.Error(t, err)
	}
	persisted, err := networkinsight.ReadDetectionPriority(singleton.DB)
	require.NoError(t, err)
	require.Equal(t, before.Order, persisted.Order)
}
func TestBatchFeaturesMixedAndIdempotent(t *testing.T) {
	setupServerGroupVisibilityFixture(t)
	require.NoError(t, singleton.DB.Model(&model.Server{}).Where("id = 1").Updates(map[string]any{"bgp_disabled": true, "connectivity_disabled": true, "note": "keep", "public_note": "logo"}).Error)
	singleton.ServerShared = singleton.NewServerClass()
	admin := &model.User{Common: model.Common{ID: 1}, Role: model.RoleAdmin}
	body := `{"ids":[1,2,1],"connectivity_disabled":false,"bgp_disabled":false,"return_route_disabled":true,"streaming_disabled":true}`
	result, err := batchUpdateServerVisibility(visibilityContext(body, admin))
	require.NoError(t, err)
	require.Equal(t, 2, result.Updated)
	var rows []model.Server
	require.NoError(t, singleton.DB.Where("id IN ?", []uint64{1, 2}).Order("id").Find(&rows).Error)
	for i := range rows {
		s := &rows[i]
		require.False(t, s.ConnectivityDisabled)
		require.False(t, s.BGPDisabled)
		require.True(t, s.ReturnRouteDisabled)
		require.True(t, s.StreamingDisabled)
		cached, _ := singleton.ServerShared.Get(s.ID)
		require.True(t, cached.ReturnRouteDisabled)
		require.False(t, cached.BGPDisabled)
	}
	require.Equal(t, "keep", rows[0].Note)
	require.Equal(t, "logo", rows[0].PublicNote)
	require.True(t, rows[1].HideForGuest)
	stamp := rows[0].UpdatedAt
	result, err = batchUpdateServerVisibility(visibilityContext(body, admin))
	require.NoError(t, err)
	require.Zero(t, result.Updated)
	var row model.Server
	require.NoError(t, singleton.DB.First(&row, 1).Error)
	require.Equal(t, stamp, row.UpdatedAt)
	result, err = batchUpdateServerVisibility(visibilityContext(`{"ids":[1,2],"return_route_disabled":false}`, admin))
	require.NoError(t, err)
	require.Equal(t, 2, result.Updated)
	require.NoError(t, singleton.DB.First(&row, 1).Error)
	require.False(t, row.ReturnRouteDisabled)
	require.True(t, row.StreamingDisabled)
}

func TestBatchLocalOnlyPreservesOtherFeaturesAndIsIdempotent(t *testing.T) {
	setupServerGroupVisibilityFixture(t)
	admin := &model.User{Common: model.Common{ID: 1}, Role: model.RoleAdmin}
	body := `{"ids":[1,2],"connectivity_disabled":true,"connectivity_local_only":true}`
	for _, count := range []int{2, 0} {
		result, err := batchUpdateServerVisibility(visibilityContext(body, admin))
		require.NoError(t, err)
		require.Equal(t, count, result.Updated)
	}
	for _, id := range []uint64{1, 2} {
		var row model.Server
		require.NoError(t, singleton.DB.First(&row, id).Error)
		require.True(t, row.ConnectivityDisabled)
		require.True(t, row.ConnectivityLocalOnly)
		require.False(t, row.BGPDisabled)
		cached, _ := singleton.ServerShared.Get(id)
		require.True(t, cached.RuntimeCopy(model.RuntimeSnapshot{}).ConnectivityLocalOnly)
	}
	result, err := batchUpdateServerVisibility(visibilityContext(`{"ids":[1],"connectivity_disabled":true,"connectivity_local_only":false}`, admin))
	require.NoError(t, err)
	require.Equal(t, 1, result.Updated)
	var a, b model.Server
	require.NoError(t, singleton.DB.First(&a, 1).Error)
	require.NoError(t, singleton.DB.First(&b, 2).Error)
	require.False(t, a.ConnectivityLocalOnly)
	require.True(t, b.ConnectivityLocalOnly)
}
