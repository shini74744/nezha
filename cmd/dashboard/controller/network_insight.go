package controller

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/connectivity"
	"github.com/nezhahq/nezha/service/networkinsight"
	"github.com/nezhahq/nezha/service/rpc"
	"github.com/nezhahq/nezha/service/singleton"
	"log"
	"sort"
	"strconv"
	"sync"
	"time"
)

type insightResponse struct {
	networkinsight.Snapshot
	ServerID uint64                    `json:"server_id"`
	CanRun   bool                      `json:"can_run"`
	Online   bool                      `json:"online"`
	History  []networkinsight.Snapshot `json:"history,omitempty"`
}

var insightJobs = struct {
	sync.Mutex
	values map[string]networkinsight.Snapshot
}{values: map[string]networkinsight.Snapshot{}}
var insightSlots = make(chan struct{}, 3)

func insightEnabled(s *model.Server, kind string) bool {
	return s != nil && ((kind == "bgp" && !s.BGPDisabled) || (kind == "streaming" && !s.StreamingDisabled))
}
func insightServer(c *gin.Context, kind string) (*model.Server, error) {
	id, e := strconv.ParseUint(c.Param("id"), 10, 64)
	if e != nil || id == 0 {
		return nil, errors.New("invalid server ID")
	}
	s, ok := singleton.ServerShared.Get(id)
	if !ok || !userCanViewServer(c, s) || !insightEnabled(s, kind) {
		return nil, errors.New("server not found")
	}
	return s, nil
}
func insightIdentity(s *model.Server) (string, model.IP, error) {
	var row model.ServerIPHistory
	if singleton.DB == nil {
		return "", model.IP{}, errors.New("database unavailable")
	}
	if err := singleton.DB.Where("server_uuid = ?", s.UUID).Limit(1).Find(&row).Error; err != nil {
		return "", model.IP{}, err
	}
	raw := fmt.Sprintf("%s:%s:%s", connectivityKey(s), row.CurrentIP.IPv4Addr, row.CurrentIP.IPv6Addr)
	return fmt.Sprintf("%x", sha256.Sum256([]byte(raw))), row.CurrentIP, nil
}
func insightPolicy() (connectivity.Policy, error) {
	settingsMutationMu.Lock()
	defer settingsMutationMu.Unlock()
	return (connectivity.Store{DB: singleton.DB}).Policy()
}
func insightLatest(identity, kind string, cutoff int64) (networkinsight.Snapshot, error) {
	var row networkinsight.Record
	err := singleton.DB.Where("identity = ? AND kind = ? AND finished_at >= ?", identity, kind, cutoff).Order("finished_at DESC").Limit(1).Find(&row).Error
	snap := networkinsight.Snapshot{State: "idle"}
	if kind == "streaming" {
		snap.Results = networkinsight.EmptyMedia()
	}
	if err == nil && row.ID != 0 {
		err = json.Unmarshal([]byte(row.Payload), &snap)
	}
	return snap, err
}
func cloneInsight(v networkinsight.Snapshot) networkinsight.Snapshot {
	raw, _ := json.Marshal(v)
	var copy networkinsight.Snapshot
	_ = json.Unmarshal(raw, &copy)
	return copy
}
func readInsight(c *gin.Context, kind string) (*insightResponse, error) {
	c.Header("Cache-Control", "no-store")
	s, err := insightServer(c, kind)
	if err != nil {
		return nil, err
	}
	identity, _, err := insightIdentity(s)
	if err != nil {
		return nil, err
	}
	p, err := insightPolicy()
	if err != nil {
		return nil, err
	}
	cutoff := time.Now().Add(-time.Duration(p.RetentionDays) * 24 * time.Hour).UnixMilli()
	snap, err := insightLatest(identity, kind, cutoff)
	if err != nil {
		return nil, err
	}
	insightJobs.Lock()
	if live, ok := insightJobs.values[identity+kind]; ok {
		snap = cloneInsight(live)
	}
	insightJobs.Unlock()
	out := &insightResponse{Snapshot: snap, ServerID: s.ID, CanRun: canRunConnectivity(c, s), Online: rpc.ConnectivityOnline(s)}
	if kind == "bgp" {
		var rows []networkinsight.Record
		if err = singleton.DB.Where("identity = ? AND kind = ? AND finished_at >= ?", identity, kind, cutoff).Order("finished_at DESC").Limit(12).Find(&rows).Error; err != nil {
			return nil, err
		}
		for _, row := range rows {
			var item networkinsight.Snapshot
			if json.Unmarshal([]byte(row.Payload), &item) == nil {
				out.History = append(out.History, item)
			}
		}
	}
	current, err := insightServer(c, kind)
	if err != nil {
		return nil, err
	}
	key, _, err := insightIdentity(current)
	if err != nil || key != identity {
		return nil, errors.New("server changed; reload")
	}
	return out, nil
}
func startInsight(c *gin.Context, kind string) (*insightResponse, error) {
	s, err := insightServer(c, kind)
	if err != nil {
		return nil, err
	}
	if !canRunConnectivity(c, s) {
		return nil, errors.New("permission denied")
	}
	if c.Request.ContentLength != 0 || len(c.Request.TransferEncoding) > 0 || c.Request.URL.RawQuery != "" {
		return nil, errors.New("检测不接受自定义地址或命令")
	}
	if kind == "streaming" && !rpc.ConnectivityOnline(s) {
		return nil, errors.New("节点离线，无法发起流媒体检测")
	}
	if err = launchInsight(s, kind, false); err != nil {
		return nil, err
	}
	return readInsight(c, kind)
}
func getBGP(c *gin.Context) (*insightResponse, error)         { return readInsight(c, "bgp") }
func startBGP(c *gin.Context) (*insightResponse, error)       { return startInsight(c, "bgp") }
func getStreaming(c *gin.Context) (*insightResponse, error)   { return readInsight(c, "streaming") }
func startStreaming(c *gin.Context) (*insightResponse, error) { return startInsight(c, "streaming") }
func launchInsight(s *model.Server, kind string, automatic bool) error {
	if !insightEnabled(s, kind) {
		return errors.New("feature disabled")
	}
	identity, ips, err := insightIdentity(s)
	if err != nil {
		return err
	}
	if kind == "bgp" && !networkinsight.PublicIP(ips.IPv4Addr) && !networkinsight.PublicIP(ips.IPv6Addr) {
		return errors.New("节点尚未上报公网 IP")
	}
	p, err := insightPolicy()
	if err != nil {
		return err
	}
	now := time.Now().UnixMilli()
	key := identity + kind
	insightJobs.Lock()
	// Read cooldown while holding the reservation lock, including a completion
	// that persisted between this caller's initial checks and lock acquisition.
	latest, err := insightLatest(identity, kind, time.Now().Add(-time.Duration(p.RetentionDays)*24*time.Hour).UnixMilli())
	if err != nil {
		insightJobs.Unlock()
		return err
	}
	if _, ok := insightJobs.values[key]; ok {
		insightJobs.Unlock()
		return errors.New("检测已在执行")
	}
	if latest.RetryAt > now {
		insightJobs.Unlock()
		return errors.New("请稍后重试")
	}
	select {
	case insightSlots <- struct{}{}:
	default:
		insightJobs.Unlock()
		return errors.New("检测繁忙，请稍后重试")
	}
	snap := latest
	snap.State = "running"
	snap.StartedAt = now
	snap.RetryAt = now + 5*60*1000
	insightJobs.values[key] = cloneInsight(snap)
	insightJobs.Unlock()
	go func() {
		defer func() { insightJobs.Lock(); delete(insightJobs.values, key); insightJobs.Unlock(); <-insightSlots }()
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		valid := func() bool {
			current, ok := singleton.ServerShared.Get(s.ID)
			if !ok || !insightEnabled(current, kind) {
				return false
			}
			got, _, e := insightIdentity(current)
			if e != nil || got != identity {
				return false
			}
			if automatic && !connectivityAutoEnabled.Load() {
				return false
			}
			return true
		}
		if !valid() {
			return
		}
		if kind == "bgp" {
			snap.Topologies = nil
			for _, item := range []struct{ ip, family string }{{ips.IPv4Addr, "IPv4"}, {ips.IPv6Addr, "IPv6"}} {
				if !valid() {
					return
				}
				snap.Topologies = append(snap.Topologies, networkinsight.QueryBGP(ctx, item.ip, item.family))
			}
		} else {
			snap.Results = networkinsight.EmptyMedia()
			probe := rpc.MediaProbe(s)
			var wg sync.WaitGroup
			var mu sync.Mutex
			sem := make(chan struct{}, 3)
			for i, item := range snap.Results {
				wg.Add(1)
				go func(i int, item networkinsight.MediaResult) {
					defer wg.Done()
					select {
					case sem <- struct{}{}:
					case <-ctx.Done():
						item.Status = "timeout"
						mu.Lock()
						snap.Results[i] = item
						mu.Unlock()
						return
					}
					defer func() { <-sem }()
					if !valid() {
						item.Status = "disabled"
					} else if item.Family == "IPv6" && !networkinsight.PublicIP(ips.IPv6Addr) {
						item.Status = "no_address"
					} else {
						item = probe(ctx, item.ID, item.Family)
					}
					mu.Lock()
					snap.Results[i] = item
					insightJobs.Lock()
					insightJobs.values[key] = cloneInsight(snap)
					insightJobs.Unlock()
					mu.Unlock()
				}(i, item)
			}
			wg.Wait()
		}
		if !valid() {
			return
		}
		snap.State = "complete"
		snap.FinishedAt = time.Now().UnixMilli()
		raw, e := json.Marshal(snap)
		if e != nil {
			return
		}
		if e = singleton.DB.Create(&networkinsight.Record{Identity: identity, Kind: kind, FinishedAt: snap.FinishedAt, Payload: string(raw)}).Error; e != nil {
			log.Printf("NEZHA>> network insight persistence failed: %v", e)
		}
	}()
	return nil
}

var insightAutomationOnce sync.Once

func StartNetworkInsightAutomation() {
	insightAutomationOnce.Do(func() {
		go func() {
			ticker := time.NewTicker(15 * time.Second)
			defer ticker.Stop()
			var cleaned time.Time
			for now := range ticker.C {
				p, err := insightPolicy()
				if err != nil {
					continue
				}
				if now.Sub(cleaned) >= time.Minute {
					if err = singleton.DB.Where("finished_at < ?", now.Add(-time.Duration(p.RetentionDays)*24*time.Hour).UnixMilli()).Delete(&networkinsight.Record{}).Error; err != nil {
						log.Printf("NEZHA>> network insight prune failed: %v", err)
					}
					cleaned = now
				}
				if !p.Enabled {
					continue
				}
				type candidate struct {
					s    *model.Server
					kind string
					last int64
				}
				candidates := []candidate{}
				singleton.ServerShared.Range(func(_ uint64, s *model.Server) bool {
					if !rpc.ConnectivityOnline(s) {
						return true
					}
					key, ips, e := insightIdentity(s)
					if e != nil {
						return true
					}
					for _, kind := range []string{"bgp", "streaming"} {
						if !insightEnabled(s, kind) || (kind == "bgp" && !networkinsight.PublicIP(ips.IPv4Addr) && !networkinsight.PublicIP(ips.IPv6Addr)) {
							continue
						}
						var row networkinsight.Record
						if singleton.DB.Select("finished_at").Where("identity = ? AND kind = ?", key, kind).Order("finished_at DESC").Limit(1).Find(&row).Error != nil {
							continue
						}
						if now.UnixMilli()-row.FinishedAt >= int64(time.Duration(p.IntervalHours)*time.Hour/time.Millisecond) {
							candidates = append(candidates, candidate{s, kind, row.FinishedAt})
						}
					}
					return true
				})
				sort.Slice(candidates, func(i, j int) bool {
					if candidates[i].last != candidates[j].last {
						return candidates[i].last < candidates[j].last
					}
					if candidates[i].s.ID != candidates[j].s.ID {
						return candidates[i].s.ID < candidates[j].s.ID
					}
					return candidates[i].kind < candidates[j].kind
				})
				dispatched := 0
				for _, v := range candidates {
					if launchInsight(v.s, v.kind, true) == nil {
						dispatched++
						if dispatched >= 2 {
							break
						}
					}
				}
			}
		}()
	})
}
