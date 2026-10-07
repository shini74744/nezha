package controller

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/connectivity"
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

type connectivityPolicyState struct {
	connectivity.Policy
	Revision string `json:"revision"`
}

func policyState(p connectivity.Policy) connectivityPolicyState {
	raw, _ := json.Marshal(p)
	return connectivityPolicyState{p, appearanceRevision(string(raw), "connectivity-policy")}
}

// @Summary Read connectivity automation policy
// @Tags auth required
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse[connectivityPolicyState]
// @Router /setting/connectivity/automation [get]
func getConnectivityAutomation(c *gin.Context) (*connectivityPolicyState, error) {
	c.Header("Cache-Control", "no-store")
	settingsMutationMu.Lock()
	defer settingsMutationMu.Unlock()
	p, err := (connectivity.Store{DB: singleton.DB}).Policy()
	state := policyState(p)
	return &state, err
}

// @Summary Save connectivity automation policy (admin only)
// @Tags auth required
// @Security BearerAuth
// @Param request body connectivityPolicyState true "Policy with revision"
// @Success 200 {object} model.CommonResponse[connectivityPolicyState]
// @Router /setting/connectivity/automation [put]
func updateConnectivityAutomation(c *gin.Context) (*connectivityPolicyState, error) {
	c.Header("Cache-Control", "no-store")
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	var form connectivityPolicyState
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&form); err != nil {
		return nil, errors.New("自动检测设置无效")
	}
	if decoder.Decode(new(any)) != io.EOF {
		return nil, errors.New("自动检测设置必须为单个 JSON 对象")
	}
	if err := form.Policy.Validate(); err != nil {
		return nil, err
	}
	settingsMutationMu.Lock()
	defer settingsMutationMu.Unlock()
	current, err := (connectivity.Store{DB: singleton.DB}).Policy()
	if err != nil {
		return nil, err
	}
	if form.Revision != policyState(current).Revision {
		return nil, errors.New("设置已被其他页面修改，请重新加载")
	}
	form.Policy.ID = 1
	if err = singleton.DB.Save(&form.Policy).Error; err != nil {
		return nil, err
	}
	connectivityAutoEnabled.Store(form.Policy.Enabled)
	connectivityManager.SetRetention(time.Duration(form.Policy.RetentionDays) * 24 * time.Hour)
	state := policyState(form.Policy)
	return &state, nil
}

func connectivityCached(key string, targets []connectivity.Target) connectivity.Snapshot {
	if connectivityManager.HasCached(key) {
		return connectivityManager.Get(key, targets)
	}
	if singleton.DB != nil && singleton.DB.Migrator().HasTable(&connectivity.Record{}) {
		store := connectivity.Store{DB: singleton.DB}
		if p, err := store.Policy(); err == nil {
			retention := time.Duration(p.RetentionDays) * 24 * time.Hour
			connectivityManager.SetRetention(retention)
			if cached, ok, err := store.Latest(key, time.Now().Add(-retention).UnixMilli()); err == nil && ok {
				connectivityManager.Restore(key, cached)
			}
		}
	}
	return connectivityManager.Get(key, targets)
}

// Recheck identity and the per-node switch before each outgoing task. Turning
// auto off stops dispatch of further automatic attempts, without affecting manual runs.
func guardedConnectivityProbe(server *model.Server, targets []connectivity.Target, auto bool) connectivity.Probe {
	identity := connectivityKey(server)
	probe := rpc.ConnectivityProbe(server, targets)
	return func(ctx context.Context, target connectivity.Target) connectivity.Sample {
		current, ok := singleton.ServerShared.Get(server.ID)
		if !ok || connectivityKey(current) != identity || current.ConnectivityDisabled {
			return connectivity.Sample{Status: "query_disabled"}
		}
		if auto && !connectivityAutoEnabled.Load() {
			return connectivity.Sample{Status: "query_disabled"}
		}
		return probe(ctx, target)
	}
}

var connectivityAutomationOnce sync.Once
var connectivityAutoEnabled atomic.Bool

func StartConnectivityAutomation() {
	connectivityAutomationOnce.Do(func() {
		connectivityManager.SetCompletionHandler(func(key string, snapshot connectivity.Snapshot) {
			id, _ := strconv.ParseUint(strings.Split(key, ":")[0], 10, 64)
			err := persistConnectivityRecord(context.Background(), singleton.DB, key, snapshot, func() bool {
				server, ok := singleton.ServerShared.Get(id)
				return ok && !server.ConnectivityDisabled && connectivityKey(server) == key
			})
			if err != nil && !errors.Is(err, errDetectionIdentityChanged) {
				log.Printf("NEZHA>> connectivity persist failed: server=%d finished_at=%d error=%v", id, snapshot.FinishedAt, err)
			}
		})
		go func() {
			scheduler := connectivity.Scheduler{}
			ticker := time.NewTicker(15 * time.Second)
			defer ticker.Stop()
			var cleaned time.Time
			for now := range ticker.C {
				store := connectivity.Store{DB: singleton.DB}
				settingsMutationMu.Lock()
				p, err := store.Policy()
				connectivityAutoEnabled.Store(err == nil && p.Enabled)
				settingsMutationMu.Unlock()
				if err != nil {
					continue
				}
				connectivityManager.SetRetention(time.Duration(p.RetentionDays) * 24 * time.Hour)
				if now.Sub(cleaned) >= time.Minute {
					if err = store.Prune(now, p); err != nil {
						log.Printf("NEZHA>> connectivity prune failed: %v", err)
					}
					cleaned = now
				}
				if !p.Enabled {
					continue
				}
				targets, err := configuredConnectivityTargets()
				if err != nil || len(targets) == 0 {
					continue
				}
				nodes := []connectivity.Candidate{}
				singleton.ServerShared.Range(func(_ uint64, server *model.Server) bool {
					if server != nil && !server.ConnectivityDisabled && rpc.ConnectivityOnline(server) {
						nodes = append(nodes, connectivity.Candidate{Key: connectivityKey(server), ID: server.ID})
					}
					return true
				})
				err = scheduler.Tick(now, p, nodes, store.LastFull, func(node connectivity.Candidate) error {
					server, ok := singleton.ServerShared.Get(node.ID)
					if !ok || server.ConnectivityDisabled || connectivityKey(server) != node.Key || !rpc.ConnectivityOnline(server) {
						return connectivity.ErrNotReady
					}
					current := connectivityCached(node.Key, targets)
					if current.State == "running" || now.UnixMilli() < current.RetryAt {
						return connectivity.ErrNotReady
					}
					_, err := connectivityManager.StartScheduled(node.Key, guardedConnectivityProbe(server, targets, true), targets, connectivity.ClockSlot(now, p.IntervalHours).UnixMilli())
					return err
				})
				if err != nil {
					log.Printf("NEZHA>> connectivity automatic run failed: %v", err)
				}
			}
		}()
	})
}
