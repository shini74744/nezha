package sshlogin

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

type savedState struct {
	AppliedPolicy   *Policy
	AppliedPrefixes []string
	Policy          Policy
	Prefixes        []string
	Cursor          cursor
	Pending         []Event
	FB5Pending      []Event
	Recent          []Event
	Completed       []uint64
	Active          bool
	HadRules        bool
	Dropped         uint64
	Native          nativeState
	Migration       *migrationSnapshot
}

func initialPolicy() Policy {
	return Policy{Success: true, Failure: true, Ports: []uint16{22}, MaxRetry: 5, FindTime: 600, BanTime: 3600, Allowlist: []string{}}
}
func privateDir(path string) error {
	for at := path; at != filepath.Dir(at); at = filepath.Dir(at) {
		st, e := os.Lstat(at)
		if e == nil {
			if !st.IsDir() || st.Mode()&os.ModeSymlink != 0 {
				return fmt.Errorf("监测状态目录无效")
			}
		}
		if e != nil && !os.IsNotExist(e) {
			return e
		}
	}
	return os.MkdirAll(path, 0700)
}
func pruneEvents(events []Event, now time.Time) []Event {
	kept := events[:0]
	for _, e := range events {
		if e.Time >= now.Add(-24*time.Hour).UnixMilli() && e.Time <= now.Add(5*time.Minute).UnixMilli() {
			kept = append(kept, e)
		}
	}
	return kept
}
func recentEvents(events []Event, now time.Time) []Event {
	out := []Event{}
	for i := len(events) - 1; i >= 0 && len(out) < 50; i-- {
		e := events[i]
		if e.Time >= now.Add(-24*time.Hour).UnixMilli() {
			out = append(out, e)
		}
	}
	return out
}
func acknowledge(state *savedState, sent Report) {
	ids := map[string]bool{}
	for _, e := range sent.Events {
		ids[e.ID] = true
	}
	keep := state.Pending[:0]
	for _, e := range state.Pending {
		if !ids[e.ID] {
			keep = append(keep, e)
		}
	}
	state.Pending = keep
	commands := map[uint64]bool{}
	for _, id := range sent.Completed {
		commands[id] = true
	}
	done := state.Completed[:0]
	for _, id := range state.Completed {
		if !commands[id] {
			done = append(done, id)
		}
	}
	state.Completed = done
}

type exchangeResult struct {
	sent  Report
	reply Reply
	err   error
}

// Run is process-scoped. Local log collection and native protection continue even
// when the dashboard transport is unavailable or reconnecting.
func Run(ctx context.Context, identity string, exchange Exchange) {
	if !SafeIdentity(identity) {
		return
	}
	sum := sha256.Sum256([]byte(identity))
	key := hex.EncodeToString(sum[:8])
	dir := filepath.Join("/var/lib/DDnezha/ssh", key)
	path := filepath.Join(dir, "state.json")
	state := savedState{Policy: initialPolicy()}
	if st, e := os.Lstat(path); e == nil && st.Mode().IsRegular() && st.Size() < 64<<20 {
		if b, e := os.ReadFile(path); e == nil {
			var saved savedState
			if json.Unmarshal(b, &saved) == nil && saved.Policy.Validate() == nil && len(saved.FB5Pending) <= 1000 && len(saved.Pending) <= 10000 && len(saved.Recent) <= 1000 && len(saved.Completed) <= 64 && len(saved.Native.Bans) <= 10000 && len(saved.Native.Failures) <= 5000 {
				if saved.Policy.BlockHash == "" || verifyPrefixes(saved.Prefixes, saved.Policy.BlockHash) == nil {
					state = saved
				}
			}
		}
	}
	state.Native.initialize()
	if state.AppliedPolicy == nil {
		old := state.Policy
		if old.Engine() == "fail2ban" {
			old = initialPolicy()
		}
		state.AppliedPolicy = &old
		state.AppliedPrefixes = append([]string{}, state.Prefixes...)
	}
	installer := &fail2banInstaller{}
	collector := collector{Cursor: state.Cursor}
	guard := banGuard{Name: "ddnezha-ssh-" + key, Dir: dir, Root: "/etc/fail2ban", Exec: run, fb5Cache: &fb5BanCache{}}
	black := blacklistGuard{Name: "ddnz_ssh_" + key, HadRules: state.HadRules}
	if m, e := guard.prepareMigrationRecovery(ctx); e == nil && m != nil {
		state.Migration = m
	}
	status := Status{Revision: state.Policy.Revision, Ports: []uint16{}, Banned: []string{}}
	save := func() error {
		state.Cursor = collector.Cursor
		state.HadRules = black.HadRules
		if err := privateDir(dir); err != nil {
			return err
		}
		b, err := json.Marshal(state)
		if err != nil {
			return err
		}
		return atomicFile(path, b)
	}
	results := make(chan exchangeResult, 1)
	inFlight := false
	nextReport, nextApply := time.Time{}, time.Time{}
	stableSince := time.Now()
	var lastPorts []uint16
	var queryID uint64
	var banQuery *BanQuery
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for ctx.Err() == nil {
		now := time.Now()
		dirty := false
		select {
		case result := <-results:
			inFlight = false
			if result.err == nil && result.reply.Policy.Validate() == nil {
				next := result.reply.Policy
				valid := true
				oldPolicy, oldPrefixes, oldActive := state.Policy, append([]string{}, state.Prefixes...), state.Active
				if next.BlockHash != state.Policy.BlockHash {
					if next.BlockHash == "" && !next.Enabled {
						state.Prefixes = nil
					} else if prefixes, e := decodePrefixes(result.reply, next.BlockHash); e != nil {
						status.Message = "黑名单校验失败，已保留原设置"
						valid = false
					} else {
						state.Prefixes = prefixes
					}
				}
				if valid {
					acknowledge(&state, result.sent)
					if next.Revision != state.Policy.Revision || next.BlockHash != state.Policy.BlockHash {
						nextApply = time.Time{}
					}
					state.Policy = next
					state.Active = state.Active || next.Enabled
					dirty = state.Active
					if state.Active {
						if e := save(); e != nil {
							state.Policy, state.Prefixes, state.Active = oldPolicy, oldPrefixes, oldActive
							status.Message = "新设置未能保存，已保留原防护设置"
							break
						}
					}
					queryID = result.reply.QueryID
					banQuery = result.reply.BanQuery
					if queryID != 0 || banQuery != nil {
						nextReport = now
					}
					for _, cmd := range result.reply.Unban {
						if slices.Contains(state.Completed, cmd.ID) {
							continue
						}
						if len(state.Completed) >= 32 {
							break
						}
						var commandErr error
						if state.applied().Engine() == "fail2ban" {
							commandErr = guard.unban(ctx, cmd.IP)
							if commandErr == nil {
								_ = state.Native.unban(cmd.IP)
								state.Completed = append(state.Completed, cmd.ID)
								dirty = true
								nextApply = time.Time{}
							} else {
								status.Message = "解封尚未完成，请检查 Fail2ban 状态"
							}
							continue
						}
						if status.Existing != nil && (state.Migration == nil || !state.Migration.Complete) {
							target := guard
							target.Reused = true
							commandErr = target.unban(ctx, cmd.IP)
						}
						if commandErr == nil {
							previous := state.Native.clone()
							commandErr = state.Native.unban(cmd.IP)
							effective := effectivePolicy(state.applied(), state.Migration)
							if commandErr == nil {
								commandErr = save()
							}
							if commandErr == nil {
								commandErr = black.apply(ctx, effective, state.AppliedPrefixes, state.Native.active(effective))
							}
							if commandErr != nil {
								state.Native = previous
								_ = save()
								_ = black.apply(ctx, effective, state.AppliedPrefixes, state.Native.active(effective))
							}
						}
						if commandErr == nil {
							state.Completed = append(state.Completed, cmd.ID)
							dirty = true
							nextApply = time.Time{}
							if sourceBlocked(next, state.Prefixes, cmd.IP) {
								status.Message = "动态封禁已解除，此 IP 仍受来源规则限制"
							}
						} else {
							status.Message = "解封尚未完成，请检查本机防护状态"
						}

					}
				}
			} else if result.err != nil && strings.Contains(result.err.Error(), "Unimplemented") {
				nextReport = now.Add(5 * time.Minute)
			}
		default:
		}
		desired := effectivePolicy(state.Policy, state.Migration)
		p := effectivePolicy(state.applied(), state.Migration)
		oldBans := len(state.Native.Bans)
		state.Native.prune(p, now)
		if len(state.Native.Bans) != oldBans {
			dirty = true
			nextApply = time.Time{}
		}
		beforePending := len(state.Pending)
		state.Pending = pruneEvents(state.Pending, now)
		if beforePending != len(state.Pending) {
			state.Dropped += uint64(beforePending - len(state.Pending))
			dirty = state.Active
		}
		state.Recent = pruneEvents(state.Recent, now)
		if now.After(nextApply) {
			status.Existing = guard.existing(ctx)
			if !state.Active {
				nextApply = now.Add(30 * time.Second)
			}
		}
		if state.Active && now.After(nextApply) {
			status.Message = ""
			var applyErr error
			if applyErr = privateDir(dir); applyErr == nil {
				if desired.Engine() == "fail2ban" {
					if desired.Enabled {
						applyErr = installer.ensure(ctx, guard, desired.Revision)
					}
					source := collector.Cursor.Source
					if source == "" && desired.Enabled {
						probe := collector
						applyErr2 := probe.initialize(ctx)
						if applyErr == nil {
							applyErr = applyErr2
						}
						if applyErr2 == nil {
							source = probe.Cursor.Source
						}
					}
					if applyErr == nil {
						applyErr = applyFB5Backend(ctx, &state, &guard, &black, desired, source, save)
					}
				} else {
					applyErr = applyNativeBackend(ctx, &state, &guard, &black, desired, save)
				}
				if applyErr == nil {
					applied := desired
					state.AppliedPolicy = &applied
					state.AppliedPrefixes = append([]string{}, state.Prefixes...)
					p = applied
					if e := save(); e != nil {
						applyErr = fmt.Errorf("防护已应用，状态尚未保存，请检查本机磁盘")
					}
				}
			}
			if applyErr != nil {
				if state.applied().Engine() == "native" {
					old := effectivePolicy(state.applied(), state.Migration)
					_ = black.apply(ctx, old, state.AppliedPrefixes, state.Native.active(old))
				}
				status.Message = applyErr.Error()
			}
			status.Backend = state.applied().Engine()
			status.BlockReady = applyErr == nil
			if applyErr == nil {
				status.BlockHash = desired.BlockHash
			}
			status.Migrated = state.Migration != nil && state.Migration.Complete
			if p.Engine() == "fail2ban" {
				status.Existing = nil
				status.Banned = []string{}
				status.BanTotal = 0
				status.BanReady = applyErr == nil
				if p.Enabled && p.AutoBan {
					entries, e := guard.readFB5Bans(ctx, time.Now())
					if e != nil {
						status.BanReady = false
						status.Message = "Fail2ban 封禁列表读取失败"
					} else {
						status.BanTotal = len(entries)
						for _, entry := range entries[:min(1000, len(entries))] {
							status.Banned = append(status.Banned, entry.IP)
						}
					}
				}
			} else if status.Migrated || status.Existing == nil {
				bans, e := black.banned()
				status.BanReady = e == nil && applyErr == nil
				if e == nil {
					status.Banned = bans[:min(1000, len(bans))]
					status.BanTotal = len(bans)
				}
			} else {
				probe := guard
				probe.Reused = true
				probe.Ready = true
				status.Banned = probe.banned(ctx)
				status.BanReady = probe.Ready && applyErr == nil
			}
			nextApply = now.Add(10 * time.Second)
		}
		if !state.Active && status.Existing != nil {
			probe := banGuard{Name: guard.Name, Reused: true, Ready: true, Exec: run}
			status.Banned = probe.banned(ctx)
			status.BanReady = probe.Ready
		}

		if len(state.FB5Pending) > 0 {
			previous := state.FB5Pending
			var flushErr error
			if p.Engine() == "fail2ban" && p.Enabled && p.AutoBan {
				flushErr = guard.publishFB5Events(p, previous, now)
			}
			if flushErr == nil {
				state.FB5Pending = nil
				if e := save(); e != nil {
					state.FB5Pending = previous
					status.Message = "SSH 失败记录未能保存"
				}
			} else {
				status.Message = "SSH 失败记录尚未交给 Fail2ban，请检查本机磁盘"
			}
		}
		ports, peers := sockets(ctx)
		slices.Sort(ports)
		if !slices.Equal(ports, lastPorts) {
			stableSince = now
			lastPorts = append([]uint16{}, ports...)
		}
		status.Ports = ports
		if p.Enabled && len(state.FB5Pending) <= 500 {
			before := collector.Cursor
			events, e := collector.poll(ctx, 500)
			if e != nil {
				status.Message = e.Error()
			} else {
				resolvePorts(events, ports, peers, stableSince)
				accepted := []Event{}
				for _, event := range events {
					if p.Includes(event) {
						accepted = append(accepted, event)
					}
				}
				oldPending := append([]Event{}, state.Pending...)
				oldFB5Pending := append([]Event{}, state.FB5Pending...)
				oldRecent := append([]Event{}, state.Recent...)
				oldNative := state.Native.clone()
				oldDropped := state.Dropped
				seenEvents := map[string]bool{}
				for _, event := range state.Recent {
					seenEvents[event.ID] = true
				}
				for _, event := range accepted {
					if seenEvents[event.ID] {
						continue
					}
					seenEvents[event.ID] = true
					state.Recent = append(state.Recent, event)
					if p.Engine() == "fail2ban" && p.Protected(event) {
						state.FB5Pending = append(state.FB5Pending, event)
					}
					beforeCount := len(state.Native.Bans)
					if e := observeNativeBackend(&state.Native, p, event, now); e != nil {
						status.Message = e.Error()
					}
					if len(state.Native.Bans) != beforeCount {
						nextApply = time.Time{}
					}
					if (event.Success && p.Success) || (!event.Success && p.Failure) {
						state.Pending = append(state.Pending, event)
					}
				}
				if len(state.Recent) > 1000 {
					state.Recent = state.Recent[len(state.Recent)-1000:]
				}
				if len(state.Pending) > 10000 {
					state.Dropped += uint64(len(state.Pending) - 10000)
					state.Pending = state.Pending[len(state.Pending)-10000:]
				}
				if before != collector.Cursor || len(accepted) > 0 {
					if e = save(); e != nil {
						collector.Cursor = before
						state.Pending = oldPending
						state.FB5Pending = oldFB5Pending
						state.Recent = oldRecent
						state.Native = oldNative
						state.Dropped = oldDropped
						status.Message = "无法保存本机登录记录"
					}
				}
			}
			status.Source = collector.Cursor.Source
		} else if !p.Enabled && collector.Cursor.Started {
			collector.Cursor = cursor{}
			state.Pending = nil
			status.Source = ""
			dirty = state.Active
		}
		if dirty {
			if e := save(); e != nil {
				status.Message = "监测状态保存失败"
			}
		}
		status.ImportedAllowlist = nil
		if state.Migration != nil && state.Migration.PolicyRevision == p.Revision {
			status.ImportedAllowlist = append([]string{}, state.Migration.Info.Allowlist...)
		}
		status.BanPaging = true
		status.BackendSelection = true
		status.AutoBanActive = state.applied().Enabled && state.applied().AutoBan
		status.Backend = state.applied().Engine()
		status.Revision = state.applied().Revision
		status.ReceivedHash = state.Policy.BlockHash
		status.Dropped = state.Dropped
		if !inFlight && !now.Before(nextReport) {
			report := Report{Events: append([]Event{}, state.Pending[:min(100, len(state.Pending))]...), Status: status, Completed: append([]uint64{}, state.Completed[:min(32, len(state.Completed))]...), QueryID: queryID}
			if queryID != 0 {
				report.Recent = recentEvents(state.Recent, now)
			}
			if banQuery != nil {
				page := readBanPage(ctx, *banQuery, status, guard, black, state.Native, now)
				report.BanPage = &page
			}
			report.Status.Banned = append([]string{}, status.Banned...)
			report.Status.Ports = append([]uint16{}, status.Ports...)
			inFlight = true
			nextReport = now.Add(10 * time.Second)
			go func(report Report) {
				callCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
				defer cancel()
				reply, err := exchange(callCtx, report)
				select {
				case results <- exchangeResult{report, reply, err}:
				case <-ctx.Done():
				}
			}(report)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func observeNativeBackend(n *nativeState, p Policy, e Event, now time.Time) error {
	if p.Engine() == "fail2ban" {
		return nil
	}
	return n.observe(p, e, now)
}
