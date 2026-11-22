package controller

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupServerListIPFixture(t *testing.T) {
	t.Helper()
	setupServerGroupVisibilityFixture(t)
	require.NoError(t, singleton.DB.AutoMigrate(&model.ServerIPHistory{}))
	for _, s := range []model.Server{
		{Common: model.Common{ID: 3, UserID: 200}, Name: "never reported", UUID: "new"},
		{Common: model.Common{ID: 4, UserID: 1}, Name: "replaced identity", UUID: "replacement"},
		{Common: model.Common{ID: 5, UserID: 1}, Name: "IPv6 only", UUID: "v6"},
		{Common: model.Common{ID: 6, UserID: 1}, Name: "no UUID"},
	} {
		require.NoError(t, singleton.DB.Create(&s).Error)
	}
	for _, r := range []model.ServerIPHistory{
		{ServerUUID: "public", CurrentIP: model.IP{IPv4Addr: "192.0.2.82", IPv6Addr: "2001:db8::82"}, History: []model.ServerIPHistoryEntry{{IP: model.IP{IPv4Addr: "192.0.2.81"}}}},
		{ServerUUID: "hidden", CurrentIP: model.IP{IPv4Addr: "192.0.2.2", IPv6Addr: "2001:db8::2"}},
		{ServerUUID: "old-replacement", CurrentIP: model.IP{IPv4Addr: "192.0.2.4"}},
		{ServerUUID: "v6", CurrentIP: model.IP{IPv6Addr: "2001:db8::5"}},
		{ServerUUID: "", CurrentIP: model.IP{IPv4Addr: "192.0.2.6"}},
	} {
		require.NoError(t, singleton.DB.Create(&r).Error)
	}
	singleton.ServerShared = singleton.NewServerClass()
}

func serverListResponse(t *testing.T, user *model.User, tok *model.APIToken) []model.Server {
	t.Helper()
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", "/api/v1/server", nil)
	c.Set(model.CtxKeyAuthorizedUser, user)
	if tok != nil {
		c.Set(model.CtxKeyAPIToken, tok)
	}
	listHandler(listServer)(c)
	require.Equal(t, 200, w.Code)
	var response struct {
		Success bool           `json:"success"`
		Data    []model.Server `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
	require.True(t, response.Success, w.Body.String())
	return response.Data
}

func TestServerListIPSurvivesRestartWithoutChangingRuntime(t *testing.T) {
	setupServerListIPFixture(t)
	admin := &model.User{Common: model.Common{ID: 1}, Role: model.RoleAdmin}
	shared, _ := singleton.ServerShared.Get(1)
	require.Empty(t, shared.GeoIP.IP.Join())
	for restart := 0; restart < 2; restart++ {
		rows := serverListResponse(t, admin, nil)
		got := make(map[uint64]model.Server)
		for _, s := range rows {
			got[s.ID] = s
		}
		require.Equal(t, model.IP{IPv4Addr: "192.0.2.82", IPv6Addr: "2001:db8::82"}, got[1].GeoIP.IP)
		require.Equal(t, "2001:db8::5", got[5].GeoIP.IP.IPv6Addr)
		for _, id := range []uint64{3, 4, 6} {
			require.Empty(t, got[id].GeoIP.IP.Join())
		}
		require.True(t, got[1].LastActive.IsZero(), "last known IP must not imply online")
		require.Empty(t, got[1].Host.Version, "do not manufacture live host info")
		require.Empty(t, shared.GeoIP.IP.Join(), "do not hydrate shared network state")
		singleton.ServerShared = singleton.NewServerClass()
	}
}

func TestServerListIPPrefersEntireFreshPairAndUsesLatestPersistedPair(t *testing.T) {
	setupServerListIPFixture(t)
	admin := &model.User{Common: model.Common{ID: 1}, Role: model.RoleAdmin}
	live, _ := singleton.ServerShared.Get(2)
	live.GeoIP = &model.GeoIP{IP: model.IP{IPv4Addr: "198.51.100.2"}, CountryCode: "us"}
	offline, _ := singleton.ServerShared.Get(1)
	offline.GeoIP = nil
	for _, row := range serverListResponse(t, admin, nil) {
		if row.ID == 2 {
			require.Equal(t, "198.51.100.2", row.GeoIP.IP.IPv4Addr)
			require.Empty(t, row.GeoIP.IP.IPv6Addr, "an old IPv6 must not be merged into a new IPv4-only report")
			require.Equal(t, "us", row.GeoIP.CountryCode)
		}
	}
	require.Nil(t, offline.GeoIP)
	require.NoError(t, singleton.DB.Save(&model.ServerIPHistory{ServerUUID: "public", CurrentIP: model.IP{IPv4Addr: "203.0.113.82"}}).Error)
	for _, row := range serverListResponse(t, admin, nil) {
		if row.ID == 1 {
			require.Equal(t, model.IP{IPv4Addr: "203.0.113.82"}, row.GeoIP.IP)
		}
	}
}

func TestServerListIPPersistedAddressesRespectOwnerAndPAT(t *testing.T) {
	setupServerListIPFixture(t)
	member := &model.User{Common: model.Common{ID: 200}, Role: model.RoleMember}
	rows := serverListResponse(t, member, nil)
	require.Len(t, rows, 1)
	require.EqualValues(t, 3, rows[0].ID)
	admin := &model.User{Common: model.Common{ID: 1}, Role: model.RoleAdmin}
	token := &model.APIToken{}
	token.SetServerIDs([]uint64{5})
	rows = serverListResponse(t, admin, token)
	require.Len(t, rows, 1)
	require.EqualValues(t, 5, rows[0].ID)
	require.Equal(t, "2001:db8::5", rows[0].GeoIP.IP.IPv6Addr)
}

func TestServerListIPUsesOneBatchQueryAndSkipsItWhenUnneeded(t *testing.T) {
	setupServerListIPFixture(t)
	rows := make([]*model.Server, 120)
	for i := range rows {
		rows[i] = &model.Server{UUID: "public", GeoIP: &model.GeoIP{}}
	}
	queries := []string{}
	require.NoError(t, singleton.DB.Callback().Query().After("gorm:query").Register("count_ip_queries", func(tx *gorm.DB) {
		queries = append(queries, tx.Statement.SQL.String())
	}))
	require.NoError(t, restoreServerListIPs(rows))
	require.Len(t, queries, 1)
	require.Contains(t, queries[0], "current_ip")
	require.False(t, strings.Contains(queries[0], "`history`"), "do not read old address histories")
	for _, row := range rows {
		require.Equal(t, "192.0.2.82", row.GeoIP.IP.IPv4Addr)
	}
	require.NoError(t, restoreServerListIPs(rows))
	require.Len(t, queries, 1, "already populated rows need no query")
	require.NoError(t, restoreServerListIPs(nil))
}
