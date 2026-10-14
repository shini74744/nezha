package controller

import (
	"context"
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/connectivity"
	"github.com/nezhahq/nezha/service/latency"
	"github.com/nezhahq/nezha/service/networkinsight"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func setupLatency(t *testing.T) {
	setupServerGroupVisibilityFixture(t)
	require.NoError(t, singleton.DB.AutoMigrate(&latency.Settings{}, &latency.Record{}, &model.ServerIPHistory{}, &networkinsight.Record{}, &networkinsight.BGPPolicy{}))
	old := latencyManager
	latencyManager = connectivity.NewLatencyManager()
	oldAuto := latencyAutoEnabled.Load()
	oldPrune := latencyLastPrune
	t.Cleanup(func() { latencyManager = old; latencyAutoEnabled.Store(oldAuto); latencyLastPrune = oldPrune })
}
func latencyContext(body string) *gin.Context {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("PUT", "/", strings.NewReader(body))
	return c
}
func TestLatencySettingsRevisionValidationAndSeparatePolicy(t *testing.T) {
	setupLatency(t)
	s, e := getLatencySettings(latencyContext(""))
	require.NoError(t, e)
	require.False(t, s.Enabled)
	s.IntervalHours = 4
	s.RetentionDays = 7
	s.Targets[0].Port = 443
	s.Targets[0].Host = "example.com"
	raw, _ := json.Marshal(s)
	saved, e := updateLatencySettings(latencyContext(string(raw)))
	require.NoError(t, e)
	require.NotEqual(t, s.Revision, saved.Revision)
	_, e = updateLatencySettings(latencyContext(string(raw)))
	require.Error(t, e)
	saved.Targets[0].Host = "127.0.0.1"
	raw, _ = json.Marshal(saved)
	_, e = updateLatencySettings(latencyContext(string(raw)))
	require.Error(t, e)
	for _, body := range []string{"{}", "{} {}", `{"unexpected":true}`} {
		_, e = updateLatencySettings(latencyContext(body))
		require.Error(t, e)
	}
	s, e = getLatencySettings(latencyContext(""))
	require.NoError(t, e)
	require.Equal(t, "example.com", s.Targets[0].Host)
	require.NoError(t, latencySchedulerTick(time.Now()))
	require.False(t, latencyAutoEnabled.Load())
}
func TestLatencyReadPermissionsHiddenAndNoGETProbes(t *testing.T) {
	setupLatency(t)
	admin := &model.User{Common: model.Common{ID: 10}, Role: model.RoleAdmin}
	owner := &model.User{Common: model.Common{ID: 1}, Role: model.RoleMember}
	for _, u := range []*model.User{nil, admin, owner} {
		v, e := getLatency(connectivityContext("1", u))
		require.NoError(t, e)
		require.Equal(t, "idle", v.State)
		require.Equal(t, u != nil, v.CanRun)
		require.Len(t, v.Results, 93)
	}
	_, e := getLatency(connectivityContext("2", nil))
	require.Error(t, e)
	_, e = startLatency(connectivityContext("1", nil))
	require.EqualError(t, e, "permission denied")
	c := connectivityContext("1", admin)
	c.Request = httptest.NewRequest("POST", "/", strings.NewReader("{}"))
	_, e = startLatency(c)
	require.Error(t, e)
	s, _ := singleton.ServerShared.Get(1)
	for _, mode := range []string{"hidden", "connectivity"} {
		s.NetworkDisplayMode = mode
		_, e = getLatency(connectivityContext("1", admin))
		require.Error(t, e)
	}
	s.NetworkDisplayMode = "latency"
	s.ConnectivityDisabled = true
	v, e := getLatency(connectivityContext("1", admin))
	require.NoError(t, e)
	require.Equal(t, "idle", v.State)
	var count int64
	require.NoError(t, singleton.DB.Model(&latency.Record{}).Count(&count).Error)
	require.Zero(t, count)
}
func TestLatencyHistoryTargetChangeAndMachineIsolation(t *testing.T) {
	setupLatency(t)
	s, _ := singleton.ServerShared.Get(1)
	settings := latency.Defaults()
	target := settings.Probes()[0]
	delay := 50.0
	snap := connectivity.Snapshot{State: "complete", Full: true, ScheduledAt: time.Now().Add(-time.Minute).UnixMilli(), FinishedAt: time.Now().UnixMilli(), Results: []connectivity.Result{{Target: target, Status: "ok", DelayMS: &delay}}}
	require.NoError(t, latency.Save(singleton.DB, connectivityKey(s), snap))
	c := connectivityContext("1", nil)
	c.Params = append(c.Params, gin.Param{Key: "target", Value: target.ID})
	points, e := getLatencyHistory(c)
	require.NoError(t, e)
	require.Len(t, points, 1)
	settings.Targets[0].Host = "example.com"
	require.NoError(t, singleton.DB.Save(&settings).Error)
	points, e = getLatencyHistory(c)
	require.NoError(t, e)
	require.Empty(t, points)
	settings = latency.Defaults()
	require.NoError(t, singleton.DB.Save(&settings).Error)
	s.MachineGeneration++
	points, e = getLatencyHistory(c)
	require.NoError(t, e)
	require.Empty(t, points)
}

func TestLatencyOldPolicyCannotDispatchAfterSettingsChange(t *testing.T) {
	setupLatency(t)
	server, ok := singleton.ServerShared.Get(1)
	require.True(t, ok)
	settings, epoch, err := latencySettingsSnapshot()
	require.NoError(t, err)
	settings.Enabled = true
	state := latencyState(settings)
	// Revision must describe the stored (disabled) policy.
	old, err := getLatencySettings(latencyContext(""))
	require.NoError(t, err)
	state.Revision = old.Revision
	raw, err := json.Marshal(state)
	require.NoError(t, err)
	_, err = updateLatencySettings(latencyContext(string(raw)))
	require.NoError(t, err)
	require.True(t, latencyAutoEnabled.Load())
	require.NotEqual(t, epoch, latencyEpoch.Load())
	for _, automatic := range []bool{false, true} {
		// Constructing the probe after save must not bless the old targets.
		probe := guardedLatencyProbe(server, settings.Probes(), automatic, epoch)
		got := probe(context.Background(), settings.Probes()[0])
		require.Equal(t, "query_disabled", got.Status)
	}
}

func TestLatencyUsesBGPFamilyAvailabilityAndCurrentIdentity(t *testing.T) {
	setupLatency(t)
	server, _ := singleton.ServerShared.Get(1)
	row := model.ServerIPHistory{ServerUUID: server.UUID, CurrentIP: model.IP{IPv4Addr: "8.8.8.8", IPv6Addr: "2606:4700:4700::1111"}}
	require.NoError(t, singleton.DB.Create(&row).Error)
	read := func(want []string, count int) {
		out, e := getLatency(connectivityContext("1", nil))
		require.NoError(t, e)
		require.Equal(t, want, out.AvailableFamilies)
		require.Len(t, out.Results, count)
		require.Equal(t, "idle", out.State)
		for _, r := range out.Results {
			require.Contains(t, want, r.Family)
			require.Nil(t, r.DelayMS)
		}
	}
	read([]string{"IPv4", "IPv6"}, 186)
	row.CurrentIP.IPv6Addr = ""
	require.NoError(t, singleton.DB.Save(&row).Error)
	read([]string{"IPv4"}, 93)
	identity, _, e := insightIdentity(server)
	require.NoError(t, e)
	raw, _ := json.Marshal(networkinsight.Snapshot{State: "complete", Topologies: []networkinsight.Topology{{Family: "IPv6", Status: "ok", Prefix: "2606:4700::/32"}}})
	require.NoError(t, singleton.DB.Create(&networkinsight.Record{Identity: identity, Kind: "bgp", FinishedAt: time.Now().UnixMilli(), Payload: string(raw)}).Error)
	read([]string{"IPv4", "IPv6"}, 186)
	// Changing the current reported IP invalidates the old BGP discovery.
	row.CurrentIP = model.IP{IPv6Addr: "2606:4700:4700::1001"}
	require.NoError(t, singleton.DB.Save(&row).Error)
	read([]string{"IPv6"}, 93)
	row.CurrentIP = model.IP{}
	require.NoError(t, singleton.DB.Save(&row).Error)
	read([]string{"IPv4"}, 93)
}
func TestLatencySnapshotsFrozenScopedAndRetained(t *testing.T) {
	setupLatency(t)
	server, _ := singleton.ServerShared.Get(1)
	key := connectivityKey(server)
	now := time.Now().UnixMilli()
	target := latency.Defaults().Probes()[0]
	value := 42.0
	snap := connectivity.Snapshot{State: "complete", Full: true, ScheduledAt: now - 2000, FinishedAt: now - 1000, Results: []connectivity.Result{{Target: target, Status: "ok", DelayMS: &value}}}
	require.NoError(t, latency.Save(singleton.DB, key, snap))
	old := snap
	old.FinishedAt = now - 48*3600000
	old.ScheduledAt = old.FinishedAt - 1000
	require.NoError(t, latency.Save(singleton.DB, key, old))
	newer := snap
	newer.FinishedAt = now
	newer.ScheduledAt = now - 500
	require.NoError(t, latency.Save(singleton.DB, key, newer))
	get := func(at int64) (*connectivity.Snapshot, error) {
		c := connectivityContext("1", nil)
		c.Params = append(c.Params, gin.Param{Key: "at", Value: strconv.FormatInt(at, 10)})
		return getLatencySnapshot(c)
	}
	settings := latency.Defaults()
	settings.Targets[0].Host = "custom.example.com"
	require.NoError(t, singleton.DB.Save(&settings).Error)
	got, e := get(snap.FinishedAt)
	require.NoError(t, e)
	require.Equal(t, target, got.Results[0].Target)
	require.Equal(t, 42.0, *got.Results[0].DelayMS)
	require.Equal(t, snap.FinishedAt, got.FinishedAt)
	out, e := getLatency(connectivityContext("1", nil))
	require.NoError(t, e)
	require.Len(t, out.History, 2)
	require.Equal(t, now, out.History[0].FinishedAt)
	require.Equal(t, "custom.example.com:80", out.Results[0].Host)
	require.Nil(t, out.Results[0].DelayMS)
	_, e = get(old.FinishedAt)
	require.Error(t, e)
	_, e = get(0)
	require.Error(t, e)
	_, e = get(now + 1)
	require.Error(t, e)
	c := connectivityContext("2", nil)
	c.Params = append(c.Params, gin.Param{Key: "at", Value: strconv.FormatInt(now, 10)})
	_, e = getLatencySnapshot(c)
	require.Error(t, e)
	server.MachineGeneration++
	_, e = get(snap.FinishedAt)
	require.Error(t, e)
	out, e = getLatency(connectivityContext("1", nil))
	require.NoError(t, e)
	require.Empty(t, out.History)
}

func TestLatencyManualHistoryExcludedFromEveryReadPath(t *testing.T) {
	setupLatency(t)
	server, _ := singleton.ServerShared.Get(1)
	key := connectivityKey(server)
	now := time.Now().UnixMilli()
	target := latency.Defaults().Probes()[0]
	delay := 42.0
	auto := connectivity.Snapshot{State: "complete", Full: true, ScheduledAt: now - 1000, FinishedAt: now, Results: []connectivity.Result{{Target: target, Status: "ok", DelayMS: &delay}}}
	require.NoError(t, latency.Save(singleton.DB, key, auto))
	var legacy latency.Record
	require.NoError(t, singleton.DB.First(&legacy).Error)
	legacy.ID, legacy.ScheduledAt, legacy.FinishedAt = 0, 0, now+1000
	require.NoError(t, singleton.DB.Create(&legacy).Error)
	out, err := getLatency(connectivityContext("1", nil))
	require.NoError(t, err)
	require.Len(t, out.History, 1)
	require.Equal(t, now, out.History[0].FinishedAt)
	require.NotNil(t, out.Results[0].DelayMS)
	require.Equal(t, delay, *out.Results[0].DelayMS)
	c := connectivityContext("1", nil)
	c.Params = append(c.Params, gin.Param{Key: "target", Value: target.ID})
	points, err := getLatencyHistory(c)
	require.NoError(t, err)
	require.Len(t, points, 1)
	require.Equal(t, now, points[0].At)
	c = connectivityContext("1", nil)
	c.Params = append(c.Params, gin.Param{Key: "at", Value: strconv.FormatInt(legacy.FinishedAt, 10)})
	_, err = getLatencySnapshot(c)
	require.Error(t, err)
	manual := auto
	manual.ScheduledAt, manual.FinishedAt = 0, now+2000
	persistLatencySnapshot(key, manual)
	var count int64
	require.NoError(t, singleton.DB.Model(&latency.Record{}).Count(&count).Error)
	require.EqualValues(t, 2, count)
}
