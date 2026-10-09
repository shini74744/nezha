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

	"gorm.io/gorm"
)

type insightResponse struct {
	networkinsight.Snapshot
	ServerID          uint64                    `json:"server_id"`
	CanRun            bool                      `json:"can_run"`
	CanViewIP         bool                      `json:"can_view_ip"`
	Online            bool                      `json:"online"`
	History           []networkinsight.Snapshot `json:"history,omitempty"`
	AvailableFamilies []string                  `json:"available_families,omitempty"`
	QueuePosition     int                       `json:"queue_position,omitempty"`
}

var insightJobs = struct {
	sync.Mutex
	values map[string]networkinsight.Snapshot
}{values: map[string]networkinsight.Snapshot{}}
var insightSlots = make(chan struct{}, 3)

func insightAutomationEnabled(kind string) bool {
	if kind == "bgp" {
		return bgpAutoEnabled.Load()
	}
	if kind == "return-route" {
		return returnRouteAutoEnabled.Load()
	}
	return connectivityAutoEnabled.Load()
}

func insightEnabled(s *model.Server, kind string) bool {
	return s != nil && ((kind == "bgp" && !s.BGPDisabled) || (kind == "streaming" && !s.StreamingDisabled) || (kind == "return-route" && !s.ReturnRouteDisabled))
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
	return insightIdentityFromDB(singleton.DB, s)
}
func insightIdentityFromDB(db *gorm.DB, s *model.Server) (string, model.IP, error) {
	var row model.ServerIPHistory
	if db == nil {
		return "", model.IP{}, errors.New("database unavailable")
	}
	if err := db.Where("server_uuid = ?", s.UUID).Limit(1).Find(&row).Error; err != nil {
		return "", model.IP{}, err
	}
	raw := fmt.Sprintf("%s:%s:%s", connectivityKey(s), row.CurrentIP.IPv4Addr, row.CurrentIP.IPv6Addr)
	return fmt.Sprintf("%x", sha256.Sum256([]byte(raw))), row.CurrentIP, nil
}
func insightPolicy(kind string) (connectivity.Policy, error) {
	settingsMutationMu.Lock()
	defer settingsMutationMu.Unlock()
	if kind == "bgp" {
		p, err := networkinsight.ReadBGPPolicy(singleton.DB)
		return connectivity.Policy(p), err
	}
	if kind == "return-route" {
		p, err := networkinsight.ReadReturnPolicy(singleton.DB)
		return p.Policy, err
	}
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
	identity, ips, err := insightIdentity(s)
	if err != nil {
		return nil, err
	}
	p, err := insightPolicy(kind)
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
	out := &insightResponse{Snapshot: snap, ServerID: s.ID, CanRun: canRunConnectivity(c, s), CanViewIP: callerIsAdmin(c), Online: rpc.ConnectivityOnline(s)}
	out.AvailableFamilies = insightAvailableFamilies(ips, snap)
	if kind == "return-route" {
		out.QueuePosition = returnRoutes.position(identity + kind)
	}
	if kind == "bgp" || kind == "return-route" {
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
	annotateReturnSnapshot(&out.Snapshot)
	for i := range out.History {
		annotateReturnSnapshot(&out.History[i])
	}
	if kind == "return-route" {
		snapshots := []*networkinsight.Snapshot{&out.Snapshot}
		for i := range out.History {
			snapshots = append(snapshots, &out.History[i])
		}
		networkinsight.GroupReturnComparisons(snapshots...)
	}
	if !out.CanViewIP {
		redactInsight(&out.Snapshot, ips.IPv4Addr, ips.IPv6Addr)
		for i := range out.History {
			redactInsight(&out.History[i], ips.IPv4Addr, ips.IPv6Addr)
		}
	}
	return out, nil
}

// Only disclose protocol availability, never addresses. The identity includes
// both current IPs, so a removed IPv6 cannot reuse an older dual-stack snapshot.
func insightAvailableFamilies(ips model.IP, snap networkinsight.Snapshot) []string {
	available := map[string]bool{
		"IPv4": networkinsight.PublicIP(ips.IPv4Addr),
		"IPv6": networkinsight.PublicIP(ips.IPv6Addr),
	}
	// A successful on-node discovery may precede the next ordinary IP report.
	for _, topology := range snap.Topologies {
		if topology.Prefix != "" && topology.Status != "no_public_ip" {
			available[topology.Family] = true
		}
	}
	families := []string{}
	for _, family := range []string{"IPv4", "IPv6"} {
		if available[family] {
			families = append(families, family)
		}
	}
	if len(families) == 0 {
		families = append(families, "IPv4")
	}
	return families
}

// Operate only on response-owned snapshots, never cached or persisted data.
func annotateReturnSnapshot(s *networkinsight.Snapshot) {
	for i := range s.Routes {
		networkinsight.AnnotateReturnRoute(&s.Routes[i])
	}
}
func redactInsight(s *networkinsight.Snapshot, sources ...string) {
	for i := range s.Routes {
		networkinsight.RedactReturnRoute(&s.Routes[i], sources...)
	}
	for i := range s.Topologies {
		s.Topologies[i].Prefix = ""
	}
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
	if (kind == "streaming" || kind == "return-route") && !rpc.ConnectivityOnline(s) {
		return nil, errors.New("节点离线，无法发起检测")
	}
	if err = launchInsight(s, kind, false, callerIsAdmin(c)); err != nil {
		return nil, err
	}
	return readInsight(c, kind)
}
func getBGP(c *gin.Context) (*insightResponse, error)         { return readInsight(c, "bgp") }
func startBGP(c *gin.Context) (*insightResponse, error)       { return startInsight(c, "bgp") }
func getStreaming(c *gin.Context) (*insightResponse, error)   { return readInsight(c, "streaming") }
func startStreaming(c *gin.Context) (*insightResponse, error) { return startInsight(c, "streaming") }
func getReturnRoute(c *gin.Context) (*insightResponse, error) { return readInsight(c, "return-route") }
func startReturnRoute(c *gin.Context) (*insightResponse, error) {
	return startInsight(c, "return-route")
}
func launchInsight(s *model.Server, kind string, automatic bool, bypassCooldown ...bool) error {
	return launchInsightSelected(s, kind, automatic, nil, bypassCooldown...)
}
func launchInsightSelected(s *model.Server, kind string, automatic bool, selection *networkinsight.ReturnSelection, bypassCooldown ...bool) error {
	if !insightEnabled(s, kind) {
		return errors.New("feature disabled")
	}
	identity, ips, err := insightIdentity(s)
	if err != nil {
		return err
	}
	if kind == "bgp" && !networkinsight.PublicIP(ips.IPv4Addr) && !networkinsight.PublicIP(ips.IPv6Addr) && !rpc.ConnectivityOnline(s) {
		return errors.New("节点尚未上报公网 IP")
	}
	p, err := insightPolicy(kind)
	if err != nil {
		return err
	}
	var returnPolicy networkinsight.ReturnPolicy
	if kind == "return-route" {
		returnPolicy, err = networkinsight.ReadReturnPolicy(singleton.DB)
		if err != nil {
			return err
		}
		if err = returnPolicy.Validate(); err != nil {
			return err
		}
	}
	if selection != nil {
		if kind != "return-route" || automatic {
			return errors.New("无效的单项检测")
		}
		if !returnSelectionAllowed(returnPolicy, insightAvailableFamilies(ips, networkinsight.Snapshot{}), *selection) {
			return errors.New("目标已移除、关闭或协议族不可用，请刷新")
		}
	}
	slots := insightSlots
	var ticket *returnRouteTicket
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
	if live, ok := insightJobs.values[key]; ok {
		if kind == "return-route" && !automatic {
			if selection != nil && !returnRoutes.policyMatches(key, networkinsight.ReturnPolicyFingerprint(returnPolicy)) {
				insightJobs.Unlock()
				return errors.New("目标配置已变化，旧任务正在结束，请稍后重试")
			}
			if !returnJobCovers(live.Retest, selection) {
				insightJobs.Unlock()
				return errors.New("该节点正在进行另一项检测，请完成后重试")
			}
			returnRoutes.promote(key)
			insightJobs.Unlock()
			return nil
		}
		insightJobs.Unlock()
		return errors.New("检测已在执行")
	}
	if automatic {
		var scheduled networkinsight.Record
		err := singleton.DB.Select("scheduled_at").Where("identity = ? AND kind = ? AND scheduled_at > 0", identity, kind).Order("scheduled_at DESC").Limit(1).Find(&scheduled).Error
		if err != nil {
			insightJobs.Unlock()
			return err
		}
		if scheduled.ScheduledAt >= insightClockSlot(kind, time.UnixMilli(now), p.IntervalHours).UnixMilli() {
			insightJobs.Unlock()
			return connectivity.ErrNotReady
		}
	}
	// Return-route automation is deduplicated by its scheduled slot, not by a
	// recent manual result. Manual checks must not push the clock schedule back.
	if latest.RetryAt > now && !(automatic && kind == "return-route") && (automatic || len(bypassCooldown) == 0 || !bypassCooldown[0]) {
		insightJobs.Unlock()
		return errors.New("请稍后重试")
	}
	if kind == "return-route" {
		ticket, err = returnRoutes.reserve(s.ID, key, !automatic, networkinsight.ReturnPolicyFingerprint(returnPolicy))
		if err != nil {
			insightJobs.Unlock()
			return err
		}
	} else {
		select {
		case slots <- struct{}{}:
		default:
			insightJobs.Unlock()
			return errors.New("检测繁忙，请稍后重试")
		}
	}
	snap := latest
	snap.Retest = selection
	snap.State = "running"
	if ticket != nil && !ticket.isReady() {
		snap.State = "queued"
	}
	snap.FinishedAt = 0
	snap.ScheduledAt = 0
	if automatic {
		snap.ScheduledAt = insightClockSlot(kind, time.UnixMilli(now), p.IntervalHours).UnixMilli()
	}
	snap.StartedAt = now
	if kind == "return-route" {
		snap.Routes = prepareReturnRetest(latest, returnPolicy, insightAvailableFamilies(ips, networkinsight.Snapshot{}), selection)
	}
	snap.RetryAt = now + 5*60*1000
	insightJobs.values[key] = cloneInsight(snap)
	insightJobs.Unlock()
	go func() {
		defer func() {
			insightJobs.Lock()
			delete(insightJobs.values, key)
			if ticket != nil {
				ticket.done()
			} else {
				<-slots
			}
			insightJobs.Unlock()
		}()
		valid := func() bool {
			current, ok := singleton.ServerShared.Get(s.ID)
			if !ok || !insightEnabled(current, kind) {
				return false
			}
			got, _, e := insightIdentity(current)
			if e != nil || got != identity {
				return false
			}
			if automatic && (ticket == nil || !ticket.isManual()) && !insightAutomationEnabled(kind) {
				return false
			}
			if kind == "return-route" && !returnPolicyCurrent(singleton.DB, returnPolicy) {
				return false
			}
			return true
		}
		if !valid() {
			return
		}
		if ticket != nil {
			if !ticket.wait(valid) {
				return
			}
			snap.State = "running"
			snap.StartedAt = time.Now().UnixMilli()
			insightJobs.Lock()
			insightJobs.values[key] = cloneInsight(snap)
			insightJobs.Unlock()
		}
		deadline := 90 * time.Second
		if kind == "return-route" {
			deadline = 8 * time.Minute
		}
		ctx, cancel := context.WithTimeout(context.Background(), deadline)
		defer cancel()
		if kind == "bgp" {
			// Look up a missing IPv6 on the target Agent; never use the dashboard's egress.
			if !networkinsight.PublicIP(ips.IPv6Addr) && rpc.ConnectivityOnline(s) {
				ips.IPv6Addr = rpc.InsightIPv6(ctx, s)
			}
			if !valid() {
				return
			}
			snap.Topologies = make([]networkinsight.Topology, 2)
			var wg sync.WaitGroup
			for i, item := range []struct{ ip, family string }{{ips.IPv4Addr, "IPv4"}, {ips.IPv6Addr, "IPv6"}} {
				wg.Add(1)
				go func(i int, ip, family string) {
					defer wg.Done()
					snap.Topologies[i] = networkinsight.QueryBGP(ctx, ip, family)
				}(i, item.ip, item.family)
			}
			wg.Wait()
		} else if kind == "return-route" {
			snap.Routes = prepareReturnRetest(latest, returnPolicy, insightAvailableFamilies(ips, networkinsight.Snapshot{}), selection)
			insightJobs.Lock()
			insightJobs.values[key] = cloneInsight(snap)
			insightJobs.Unlock()
			probe := rpc.ReturnRouteProbe(s)
			var wg sync.WaitGroup
			var mu sync.Mutex
			sem := make(chan struct{}, 2)
			for i, item := range snap.Routes {
				if selection != nil && (item.ID != selection.ID || item.Family != selection.Family) {
					continue
				}
				wg.Add(1)
				go func(i int, item networkinsight.ReturnResult) {
					defer wg.Done()
					select {
					case sem <- struct{}{}:
					case <-ctx.Done():
						item.Status = "timeout"
					}
					if item.Status == "pending" {
						if !valid() {
							item.Status = "disabled"
						} else {
							item = probe(ctx, item)
						}
						<-sem
					}
					item.TestedAt = time.Now().UnixMilli()
					mu.Lock()
					snap.Routes[i] = item
					insightJobs.Lock()
					insightJobs.values[key] = cloneInsight(snap)
					insightJobs.Unlock()
					mu.Unlock()
				}(i, item)
			}
			wg.Wait()
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
		snap.State = "complete"
		snap.FinishedAt = time.Now().UnixMilli()
		raw, e := json.Marshal(snap)
		if e != nil {
			return
		}
		record := networkinsight.Record{Identity: identity, Kind: kind, FinishedAt: snap.FinishedAt, ScheduledAt: snap.ScheduledAt, Payload: string(raw)}
		e = persistNetworkInsightRecord(context.Background(), singleton.DB, record, func(db *gorm.DB) error {
			current, ok := singleton.ServerShared.Get(s.ID)
			if !ok || !insightEnabled(current, kind) {
				return errDetectionIdentityChanged
			}
			if automatic && (ticket == nil || !ticket.isManual()) && !insightAutomationEnabled(kind) {
				return errDetectionIdentityChanged
			}
			got, _, err := insightIdentityFromDB(db, current)
			if err != nil {
				return err
			}
			if got != identity {
				return errDetectionIdentityChanged
			}
			if kind == "return-route" && !returnPolicyCurrent(db, returnPolicy) {
				return errDetectionIdentityChanged
			}
			return nil
		})
		if e != nil && !errors.Is(e, errDetectionIdentityChanged) {
			log.Printf("NEZHA>> network insight persistence failed: server=%d kind=%s finished_at=%d error=%v", s.ID, kind, snap.FinishedAt, e)
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
				policies := map[string]connectivity.Policy{}
				for _, kind := range []string{"bgp", "return-route", "streaming"} {
					p, err := insightPolicy(kind)
					if err != nil {
						continue
					}
					policies[kind] = p
					if kind == "bgp" {
						bgpAutoEnabled.Store(p.Enabled)
					}
					if kind == "return-route" {
						returnRouteAutoEnabled.Store(p.Enabled)
					}
					if now.Sub(cleaned) >= time.Minute {
						if err := pruneInsight(kind, p, now); err != nil {
							log.Printf("NEZHA>> network insight prune failed: %v", err)
						}
					}
				}
				if now.Sub(cleaned) >= time.Minute {
					cleaned = now
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
					key, _, e := insightIdentity(s)
					if e != nil {
						return true
					}
					for _, kind := range []string{"bgp", "return-route", "streaming"} {
						p, ok := policies[kind]
						if !ok || !p.Enabled || !insightEnabled(s, kind) {
							continue
						}
						var row networkinsight.Record
						if singleton.DB.Select("finished_at", "scheduled_at").Where("identity = ? AND kind = ? AND scheduled_at > 0", key, kind).Order("scheduled_at DESC").Limit(1).Find(&row).Error != nil {
							continue
						}
						last := row.ScheduledAt
						if last == 0 {
							last = row.FinishedAt
						}
						if last == 0 || last < insightClockSlot(kind, now, p.IntervalHours).UnixMilli() {
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
func pruneInsight(kind string, p connectivity.Policy, now time.Time) error {
	return singleton.DB.Where("kind = ? AND finished_at < ?", kind, now.Add(-time.Duration(p.RetentionDays)*24*time.Hour).UnixMilli()).Delete(&networkinsight.Record{}).Error
}

// Do not send more probes or persist obsolete targets after an admin changes the policy.
func returnPolicyCurrent(db *gorm.DB, expected networkinsight.ReturnPolicy) bool {
	current, err := networkinsight.ReadReturnPolicy(db)
	return err == nil && networkinsight.ReturnPolicyFingerprint(current) == networkinsight.ReturnPolicyFingerprint(expected)
}
