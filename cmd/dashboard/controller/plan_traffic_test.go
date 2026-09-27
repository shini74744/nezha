package controller

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"net/http/httptest"
	"testing"
)

func TestPlanTrafficVisibilityAndPAT(t *testing.T) {
	newMemberValidationContext(t)
	require.NoError(t, singleton.DB.AutoMigrate(&model.PlanTrafficCheckpoint{}, &model.PlanTrafficDay{}))
	for _, s := range []*model.Server{
		{Common: model.Common{ID: 1, UserID: 1}, UUID: "public"},
		{Common: model.Common{ID: 2, UserID: 1}, UUID: "admin", HideForGuest: true},
		{Common: model.Common{ID: 3, UserID: 200}, UUID: "member", HideForGuest: true},
	} {
		s.Name = fmt.Sprint(s.ID)
		s.PublicNote = `{"planDataMod":{"trafficVol":"5TB/月","trafficType":"3","resetDay":"15"}}`
		if s.ID == 2 {
			s.PublicNote = `{"planDataMod":{"trafficVol":"无限","trafficType":"3"}}`
		}
		if s.ID == 3 {
			s.PublicNote = `{"planDataMod":{"trafficType":"3"}}`
		}
		require.NoError(t, singleton.DB.Create(s).Error)
	}
	singleton.ServerShared = singleton.NewServerClass()
	for _, tc := range []struct {
		name   string
		viewer *model.User
		token  *model.APIToken
		want   []uint64
	}{
		{"guest", nil, nil, []uint64{1}},
		{"member", &model.User{Common: model.Common{ID: 200}, Role: model.RoleMember}, nil, []uint64{1, 3}},
		{"admin", &model.User{Common: model.Common{ID: 1}, Role: model.RoleAdmin}, nil, []uint64{1, 2, 3}},
		{"restricted admin", &model.User{Common: model.Common{ID: 1}, Role: model.RoleAdmin}, &model.APIToken{ServersCSV: "3"}, []uint64{3}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			if tc.viewer != nil {
				c.Set(model.CtxKeyAuthorizedUser, tc.viewer)
			}
			if tc.token != nil {
				c.Set(apiTokenCtxKey, tc.token)
				c.Set(model.CtxKeyAPIToken, tc.token)
			}
			data, err := showPlanTraffic(c)
			require.NoError(t, err)
			var ids []uint64
			for id, s := range data {
				ids = append(ids, id)
				require.Equal(t, "3", s.Direction)
			}
			require.ElementsMatch(t, tc.want, ids)
		})
	}
}
