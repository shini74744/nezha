package controller

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/tsdb"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func setupServerServicePicker(t *testing.T) (uint64, uint64) {
	setupServiceDispatchPATFixture(t)
	require.NoError(t, singleton.DB.AutoMigrate(&model.ServerOperationLog{}, &model.ServerInventoryBaseline{}))
	for _, id := range []uint64{1, 2} {
		s, _ := singleton.ServerShared.Get(id)
		s.UUID = fmt.Sprintf("server-%d", id)
		require.NoError(t, singleton.DB.Create(s).Error)
	}
	a := insertServiceForDispatchTest(t, model.ServiceCoverAll, map[uint64]bool{})
	b := insertServiceForDispatchTest(t, model.ServiceCoverIgnoreAll, map[uint64]bool{})
	for id, color := range map[uint64]string{a: "#123456", b: "#abcdef"} {
		m, _ := singleton.ServiceSentinelShared.Get(id)
		m.ChartColor = color
		require.NoError(t, singleton.DB.Save(m).Error)
	}
	return a, b
}
func serverServicesContext(t *testing.T, role model.Role, rows []model.ServerServicePreference) *gin.Context {
	c := serviceOrderContext(t, 100, role, serverServicesForm{Services: rows})
	c.Params = gin.Params{{Key: "id", Value: "1"}}
	return c
}
func TestServerServicesSaveOfflineDefaultsHistoryAndIsolation(t *testing.T) {
	a, b := setupServerServicePicker(t)
	entries := []model.ServerServicePreference{{ServiceID: b}, {ServiceID: a, Color: "#AA5500"}}
	_, err := setServerServices(serverServicesContext(t, model.RoleMember, entries))
	require.Error(t, err)
	view, err := setServerServices(serverServicesContext(t, model.RoleAdmin, entries))
	require.NoError(t, err)
	require.Equal(t, "#aa5500", view.Services[1].Color)
	s, _ := singleton.ServerShared.Get(1)
	other, _ := singleton.ServerShared.Get(2)
	var stored model.Server
	require.NoError(t, singleton.DB.First(&stored, 1).Error)
	require.Equal(t, s.ServicePreferencesRaw, stored.ServicePreferencesRaw)
	require.Equal(t, s.ServicePreferencesRaw, s.RuntimeCopy(s.RuntimeSnapshot()).ServicePreferencesRaw)
	require.Nil(t, s.GetTaskStream())
	otherPrefs, _ := other.ServicePreferences()
	require.Empty(t, otherPrefs)
	bService, _ := singleton.ServiceSentinelShared.Get(b)
	require.True(t, bService.CoversServer(s))
	require.False(t, bService.CoversServer(other))
	for _, id := range []uint64{a, b} {
		require.NoError(t, singleton.DB.Create(&model.ServiceHistory{ServiceID: id, ServerID: 1, CreatedAt: time.Now(), AvgDelay: 10}).Error)
	}
	infos, err := queryServerServicesFromDB(1, s.Name, tsdb.Period1Day, singleton.ServiceSentinelShared.GetSortedList())
	require.NoError(t, err)
	require.Len(t, infos, 2)
	for _, info := range infos {
		if info.ServiceID == b {
			require.Equal(t, 2, info.DisplayIndex)
			require.Equal(t, "#abcdef", info.ChartColor)
		} else {
			require.Equal(t, 1, info.DisplayIndex)
			require.Equal(t, "#aa5500", info.ChartColor)
		}
	}
	_, err = setServerServices(serverServicesContext(t, model.RoleAdmin, []model.ServerServicePreference{}))
	require.NoError(t, err)
	s, _ = singleton.ServerShared.Get(1)
	require.False(t, bService.CoversServer(s))
	prefs, _ := s.ServicePreferences()
	require.Empty(t, prefs)
}
func TestServerServicesValidationAtomicFailureAndLimitedPAT(t *testing.T) {
	a, _ := setupServerServicePicker(t)
	for _, rows := range [][]model.ServerServicePreference{{{ServiceID: 999}}, {{ServiceID: a}, {ServiceID: a}}, {{ServiceID: a, Color: "red"}}} {
		_, err := setServerServices(serverServicesContext(t, model.RoleAdmin, rows))
		require.Error(t, err)
	}
	require.NoError(t, singleton.DB.Exec("CREATE TRIGGER fail_prefs BEFORE UPDATE OF service_preferences_raw ON servers BEGIN SELECT RAISE(ABORT,'fixture'); END").Error)
	_, err := setServerServices(serverServicesContext(t, model.RoleAdmin, []model.ServerServicePreference{{ServiceID: a}}))
	require.Error(t, err)
	s, _ := singleton.ServerShared.Get(1)
	prefs, _ := s.ServicePreferences()
	require.Empty(t, prefs)
	require.NoError(t, singleton.DB.Exec("DROP TRIGGER fail_prefs").Error)
	_, err = setServerServices(serverServicesContext(t, model.RoleAdmin, []model.ServerServicePreference{{ServiceID: a}}))
	require.NoError(t, err)
	token := &model.APIToken{UserID: 100}
	token.SetServerIDs([]uint64{2})
	c := serverServicesContext(t, model.RoleAdmin, []model.ServerServicePreference{})
	c.Set(model.CtxKeyAPIToken, token)
	_, err = setServerServices(c)
	require.Error(t, err)
	svc, _ := singleton.ServiceSentinelShared.Get(a)
	require.False(t, svc.HasPermission(c))
}
func TestServiceColorCreateEditPreserveAndAutoUnique(t *testing.T) {
	setupServiceDispatchPATFixture(t)
	form := model.ServiceForm{Name: "Color", Type: model.TaskTypeTCPPing, Target: "example.invalid:80", Cover: model.ServiceCoverIgnoreAll, Duration: 30, SkipServers: map[uint64]bool{1: true}}
	colors := map[string]bool{}
	for i := 0; i < 20; i++ {
		id, err := createService(serviceOrderContext(t, 100, model.RoleMember, form))
		require.NoError(t, err)
		row, _ := singleton.ServiceSentinelShared.Get(id)
		old := row.ChartColor
		require.NotEmpty(t, old)
		require.False(t, colors[old])
		colors[old] = true
		c := serviceOrderContext(t, 100, model.RoleMember, form)
		c.Params = gin.Params{{Key: "id", Value: fmt.Sprint(id)}}
		_, err = updateService(c)
		require.NoError(t, err)
		row, _ = singleton.ServiceSentinelShared.Get(id)
		require.Equal(t, old, row.ChartColor)
	}
	bad := "red"
	form.ChartColor = &bad
	_, err := createService(serviceOrderContext(t, 100, model.RoleMember, form))
	require.Error(t, err)
}

func TestConcurrentServiceColorAllocation(t *testing.T) {
	setupServiceDispatchPATFixture(t)
	form := model.ServiceForm{Name: "Concurrent color", Type: model.TaskTypeTCPPing, Target: "example.invalid:80", Cover: model.ServiceCoverIgnoreAll, Duration: 30, SkipServers: map[uint64]bool{1: true}}
	type result struct {
		id  uint64
		err error
	}
	results := make(chan result, 24)
	for i := 0; i < 24; i++ {
		c := serviceOrderContext(t, 100, model.RoleMember, form)
		go func() { id, err := createService(c); results <- result{id, err} }()
	}
	seen := map[string]bool{}
	for i := 0; i < 24; i++ {
		r := <-results
		require.NoError(t, r.err)
		row, _ := singleton.ServiceSentinelShared.Get(r.id)
		require.False(t, seen[row.ChartColor])
		seen[row.ChartColor] = true
	}
	require.Len(t, seen, 24)
}
