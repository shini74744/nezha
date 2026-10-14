package controller

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/connectivity"
	"github.com/nezhahq/nezha/service/latency"
	"github.com/nezhahq/nezha/service/rpc"
	"github.com/nezhahq/nezha/service/singleton"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

var latencyManager = connectivity.NewLatencyManager()
var latencyAutoEnabled atomic.Bool
var latencyEpoch atomic.Uint64
var latencyOnce sync.Once

type latencySettingsState struct {
	latency.Settings
	Revision string `json:"revision"`
}

func latencyState(s latency.Settings) latencySettingsState {
	raw, _ := json.Marshal(s)
	return latencySettingsState{s, appearanceRevision(string(raw), "latency-settings")}
}
func latencySettings() (latency.Settings, error) {
	s, _, err := latencySettingsSnapshot()
	return s, err
}

// Capture policy and generation under the same lock as settings updates.
func latencySettingsSnapshot() (latency.Settings, uint64, error) {
	settingsMutationMu.Lock()
	defer settingsMutationMu.Unlock()
	s, err := latency.Read(singleton.DB)
	if err == nil {
		latencyAutoEnabled.Store(s.Enabled)
	}
	return s, latencyEpoch.Load(), err
}

// @Summary Read latency targets and automatic detection policy
// @Tags auth required
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse[latencySettingsState]
// @Router /setting/latency [get]
func getLatencySettings(c *gin.Context) (*latencySettingsState, error) {
	c.Header("Cache-Control", "no-store")
	s, e := latencySettings()
	v := latencyState(s)
	return &v, e
}

// @Summary Save latency targets and automatic detection policy
// @Tags auth required
// @Security BearerAuth
// @Param request body latencySettingsState true "Settings and revision"
// @Success 200 {object} model.CommonResponse[latencySettingsState]
// @Router /setting/latency [put]
func updateLatencySettings(c *gin.Context) (*latencySettingsState, error) {
	c.Header("Cache-Control", "no-store")
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 128*1024)
	var form latencySettingsState
	d := json.NewDecoder(c.Request.Body)
	d.DisallowUnknownFields()
	if d.Decode(&form) != nil || d.Decode(new(any)) != io.EOF {
		return nil, errors.New("延迟设置格式无效")
	}
	if e := form.Settings.Validate(); e != nil {
		return nil, e
	}
	settingsMutationMu.Lock()
	defer settingsMutationMu.Unlock()
	old, e := latency.Read(singleton.DB)
	if e != nil {
		return nil, e
	}
	if form.Revision != latencyState(old).Revision {
		return nil, errors.New("设置已更新，请重新加载")
	}
	form.ID = 1
	if e = singleton.DB.Save(&form.Settings).Error; e != nil {
		return nil, e
	}
	latencyEpoch.Add(1)
	latencyAutoEnabled.Store(form.Enabled)
	latencyManager.SetRetention(time.Duration(form.RetentionDays) * 24 * time.Hour)
	v := latencyState(form.Settings)
	return &v, nil
}
func latencyServer(c *gin.Context) (*model.Server, error) {
	id, e := strconv.ParseUint(c.Param("id"), 10, 64)
	if e != nil || id == 0 {
		return nil, errors.New("invalid server ID")
	}
	s, ok := singleton.ServerShared.Get(id)
	if !ok || !userCanViewServer(c, s) || !s.LatencyEnabled() {
		return nil, errors.New("server not found")
	}
	return s, nil
}

// Use the same current-IP identity, completed BGP discovery and live discovery as BGP.
func latencyAvailableFamilies(server *model.Server) ([]string, error) {
	identity, ips, err := insightIdentity(server)
	if err != nil {
		return nil, err
	}
	policy, err := insightPolicy("bgp")
	if err != nil {
		return nil, err
	}
	snap, err := insightLatest(identity, "bgp", time.Now().Add(-time.Duration(policy.RetentionDays)*24*time.Hour).UnixMilli())
	if err != nil {
		return nil, err
	}
	insightJobs.Lock()
	if live, ok := insightJobs.values[identity+"bgp"]; ok {
		snap = cloneInsight(live)
	}
	insightJobs.Unlock()
	return insightAvailableFamilies(ips, snap), nil
}

type latencySnapshotSummary struct {
	FinishedAt  int64 `json:"finished_at"`
	ScheduledAt int64 `json:"scheduled_at,omitempty"`
}
type latencyResponse struct {
	connectivityResponse
	AvailableFamilies []string                 `json:"available_families"`
	History           []latencySnapshotSummary `json:"history"`
}

func latencyHistorySummaries(ctx context.Context, key string, days int) ([]latencySnapshotSummary, error) {
	out := make([]latencySnapshotSummary, 0)
	cutoff := time.Now().Add(-time.Duration(days) * 24 * time.Hour).UnixMilli()
	q := singleton.DB.WithContext(ctx).Model(&latency.Record{})
	ids := q.Select("MAX(id)").Where("identity = ? AND scheduled_at > 0 AND finished_at >= ?", key, cutoff).Group("scheduled_at").Order("MAX(finished_at) DESC").Limit(12)
	err := singleton.DB.WithContext(ctx).Model(&latency.Record{}).Select("finished_at", "scheduled_at").Where("id IN (?)", ids).Order("finished_at DESC").Scan(&out).Error
	return out, err
}
func latencyCached(key string, s latency.Settings, families ...[]string) connectivity.Snapshot {
	latencyManager.SetRetention(time.Duration(s.RetentionDays) * 24 * time.Hour)
	if !latencyManager.HasCached(key) {
		if snap, ok, e := latency.Latest(singleton.DB, key, s.RetentionDays); e == nil && ok {
			latencyManager.Restore(key, snap)
		}
	}
	return latencyManager.Get(key, s.Probes(families...))
}

// @Summary Read cached node TCP latency without initiating probes
// @Tags common
// @Param id path uint true "Server ID"
// @Success 200 {object} model.CommonResponse[latencyResponse]
// @Router /server/{id}/latency [get]
func getLatency(c *gin.Context) (*latencyResponse, error) {
	c.Header("Cache-Control", "no-store")
	server, e := latencyServer(c)
	if e != nil {
		return nil, e
	}
	key := connectivityKey(server)
	settings, e := latencySettings()
	if e != nil {
		return nil, e
	}
	families, e := latencyAvailableFamilies(server)
	if e != nil {
		return nil, e
	}
	targets := settings.Probes(families)
	snapshot := latencyCached(key, settings, families)
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	history, e := latencyHistorySummaries(ctx, key, settings.RetentionDays)
	if e != nil {
		return nil, e
	}
	current, e := latencyServer(c)
	if e != nil || connectivityKey(current) != key {
		return nil, errors.New("server changed; reload")
	}
	result := &latencyResponse{connectivityResponse: connectivityResponse{Snapshot: snapshot, FullBatch: true, ServerID: current.ID, Online: rpc.ConnectivityOnline(current), CanRun: canRunConnectivity(c, current) && len(targets) > 0}, AvailableFamilies: families, History: history}
	if snapshot.State == "running" {
		if latest, ok := latencyManager.LatestCompleted(key, targets); ok {
			result.Latest = &latest
		}
	}
	return result, nil
}
func guardedLatencyProbe(server *model.Server, targets []connectivity.Target, auto bool, epoch uint64) connectivity.Probe {
	key := connectivityKey(server)
	probe := rpc.LatencyProbe(server, targets)
	return func(ctx context.Context, t connectivity.Target) connectivity.Sample {
		s, ok := singleton.ServerShared.Get(server.ID)
		if !ok || connectivityKey(s) != key || !s.LatencyEnabled() || singleton.ServerIDReassignmentInProgress.Load() || latencyEpoch.Load() != epoch || (auto && !latencyAutoEnabled.Load()) {
			return connectivity.Sample{Status: "query_disabled"}
		}
		return probe(ctx, t)
	}
}

// @Summary Start a bounded TCP latency batch against configured targets
// @Tags auth required
// @Security BearerAuth
// @Param id path uint true "Server ID"
// @Success 200 {object} model.CommonResponse[latencyResponse]
// @Router /server/{id}/latency [post]
func startLatency(c *gin.Context) (*latencyResponse, error) {
	c.Header("Cache-Control", "no-store")
	s, e := latencyServer(c)
	if e != nil {
		return nil, e
	}
	if !canRunConnectivity(c, s) {
		return nil, errors.New("permission denied")
	}
	if c.Request.ContentLength != 0 || len(c.Request.TransferEncoding) > 0 || c.Request.URL.RawQuery != "" {
		return nil, errors.New("检测不接受自定义请求参数")
	}
	if !rpc.ConnectivityOnline(s) {
		return nil, errors.New("服务器离线")
	}
	settings, epoch, e := latencySettingsSnapshot()
	if e != nil {
		return nil, e
	}
	families, e := latencyAvailableFamilies(s)
	if e != nil {
		return nil, e
	}
	targets := settings.Probes(families)
	if len(targets) == 0 {
		return nil, errors.New("没有启用的检测地址")
	}
	key := connectivityKey(s)
	_ = latencyCached(key, settings, families)
	if _, e = latencyManager.Start(key, guardedLatencyProbe(s, targets, false, epoch), targets); e != nil {
		return nil, e
	}
	return getLatency(c)
}

type latencyPoint struct {
	At      int64    `json:"at"`
	DelayMS *float64 `json:"delay_ms,omitempty"`
	Status  string   `json:"status"`
}

// @Summary Read retained TCP latency samples for one configured target
// @Tags common
// @Param id path uint true "Server ID"
// @Param target path string true "Target ID"
// @Success 200 {object} model.CommonResponse[[]latencyPoint]
// @Router /server/{id}/latency/history/{target} [get]
func getLatencyHistory(c *gin.Context) ([]latencyPoint, error) {
	c.Header("Cache-Control", "no-store")
	s, e := latencyServer(c)
	if e != nil {
		return nil, e
	}
	key := connectivityKey(s)
	settings, e := latencySettings()
	if e != nil {
		return nil, e
	}
	var target connectivity.Target
	for _, t := range settings.Probes([]string{"IPv4", "IPv6"}) {
		if t.ID == c.Param("target") {
			target = t
			break
		}
	}
	if target.ID == "" {
		return nil, errors.New("检测地址不存在")
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	rows, e := singleton.DB.WithContext(ctx).Model(&latency.Record{}).Select("payload", "finished_at").Where("identity = ? AND scheduled_at > 0 AND finished_at >= ?", key, time.Now().Add(-time.Duration(settings.RetentionDays)*24*time.Hour).UnixMilli()).Order("finished_at DESC").Limit(1000).Rows()
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	points := make([]latencyPoint, 0)
	for rows.Next() {
		var row latency.Record
		if e = singleton.DB.ScanRows(rows, &row); e != nil {
			return nil, e
		}
		snap, e := latency.Decode(row)
		if e != nil {
			return nil, e
		}
		for _, r := range snap.Results {
			if r.ID == target.ID && r.URL == target.URL {
				points = append(points, latencyPoint{row.FinishedAt, r.DelayMS, r.Status})
				break
			}
		}
	}
	if e = rows.Err(); e != nil {
		return nil, e
	}
	current, e := latencyServer(c)
	if e != nil || connectivityKey(current) != key {
		return nil, errors.New("server changed; reload")
	}
	return points, nil
}
func persistLatencySnapshot(key string, snapshot connectivity.Snapshot) {
	if snapshot.ScheduledAt <= 0 {
		return
	}
	id, _ := strconv.ParseUint(strings.Split(key, ":")[0], 10, 64)
	e := retryDetectionPersistence(context.Background(), func(ctx context.Context) error {
		singleton.ServerMutationMu.Lock()
		defer singleton.ServerMutationMu.Unlock()
		server, ok := singleton.ServerShared.Get(id)
		if !ok || !server.LatencyEnabled() || connectivityKey(server) != key || singleton.ServerIDReassignmentInProgress.Load() {
			return errDetectionIdentityChanged
		}
		return latency.Save(singleton.DB.WithContext(ctx), key, snapshot)
	})
	if e != nil && !errors.Is(e, errDetectionIdentityChanged) {
		log.Printf("NEZHA>> latency persist failed: server=%d error=%v", id, e)
	}
}
func StartLatencyAutomation() {
	latencyOnce.Do(func() { latencyManager.SetCompletionHandler(persistLatencySnapshot) })
}

var latencyLastPrune time.Time

// Runs after the existing scheduler: latency never crowds out an already due job.
func latencySchedulerTick(now time.Time, due ...[]cardCandidate) error {
	reserved := map[uint64]bool{}
	for _, batch := range due {
		for _, candidate := range batch {
			reserved[candidate.server.ID] = true
		}
	}
	s, epoch, e := latencySettingsSnapshot()
	if e != nil {
		return e
	}
	latencyManager.SetRetention(time.Duration(s.RetentionDays) * 24 * time.Hour)
	if now.Sub(latencyLastPrune) >= time.Minute {
		if e = singleton.DB.Where("finished_at < ?", now.Add(-time.Duration(s.RetentionDays)*24*time.Hour).UnixMilli()).Delete(&latency.Record{}).Error; e != nil {
			return e
		}
		latencyLastPrune = now
	}
	if !s.Enabled || singleton.ServerIDReassignmentInProgress.Load() {
		return nil
	}
	if len(s.Probes([]string{"IPv4", "IPv6"})) == 0 {
		return nil
	}
	slot := connectivity.ClockSlot(now, s.IntervalHours).UnixMilli()
	candidates := []cardCandidate{}
	singleton.ServerShared.Range(func(_ uint64, server *model.Server) bool {
		if reserved[server.ID] || !server.LatencyEnabled() || !rpc.ConnectivityOnline(server) {
			return true
		}
		var row latency.Record
		key := connectivityKey(server)
		if e = singleton.DB.Select("scheduled_at").Where("identity = ? AND scheduled_at > 0", key).Order("scheduled_at DESC").Limit(1).Find(&row).Error; e != nil {
			return false
		}
		if row.ScheduledAt >= slot {
			return true
		}
		families, err := latencyAvailableFamilies(server)
		if err != nil {
			e = err
			return false
		}
		if len(s.Probes(families)) == 0 {
			return true
		}
		current := latencyCached(key, s, families)
		if now.UnixMilli() < current.RetryAt {
			return true
		}
		identity, _, err := insightIdentity(server)
		if err != nil {
			e = err
			return false
		}
		candidates = append(candidates, cardCandidate{server, "latency", identity, slot, row.ScheduledAt})
		return true
	})
	if e != nil {
		return e
	}
	dispatchCardCandidates(candidates, []string{"latency"}, func(v cardCandidate) bool { return cardNodeBusy(v.server, v.identity) }, func(v cardCandidate) error {
		families, err := latencyAvailableFamilies(v.server)
		if err != nil {
			return err
		}
		targets := s.Probes(families)
		if len(targets) == 0 {
			return nil
		}
		_, err = latencyManager.StartScheduled(connectivityKey(v.server), guardedLatencyProbe(v.server, targets, true, epoch), targets, v.slot)
		return err
	})
	return nil
}

// @Summary Read an immutable retained TCP latency batch
// @Tags common
// @Param id path uint true "Server ID"
// @Param at path int64 true "Snapshot completion time"
// @Success 200 {object} model.CommonResponse[connectivity.Snapshot]
// @Router /server/{id}/latency/snapshots/{at} [get]
func getLatencySnapshot(c *gin.Context) (*connectivity.Snapshot, error) {
	c.Header("Cache-Control", "no-store")
	server, err := latencyServer(c)
	if err != nil {
		return nil, err
	}
	key := connectivityKey(server)
	at, err := strconv.ParseInt(c.Param("at"), 10, 64)
	if err != nil || at <= 0 {
		return nil, errors.New("快照时间无效")
	}
	settings, err := latencySettings()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	var row latency.Record
	result := singleton.DB.WithContext(ctx).Where("identity = ? AND scheduled_at > 0 AND finished_at = ? AND finished_at >= ?", key, at, time.Now().Add(-time.Duration(settings.RetentionDays)*24*time.Hour).UnixMilli()).Limit(1).Find(&row)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, errors.New("快照不存在或已过期")
	}
	snapshot, err := latency.Decode(row)
	if err != nil {
		return nil, err
	}
	current, err := latencyServer(c)
	if err != nil || connectivityKey(current) != key {
		return nil, errors.New("server changed; reload")
	}
	return &snapshot, nil
}
