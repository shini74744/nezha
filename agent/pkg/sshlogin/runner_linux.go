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
	Policy    Policy
	Prefixes  []string
	Cursor    cursor
	Pending   []Event
	Recent    []Event
	Completed []uint64
	Active    bool
	HadRules  bool
	Dropped   uint64
	Native    nativeState
	Migration *migrationSnapshot
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
			if json.Unmarshal(b, &saved) == nil && saved.Policy.Validate() == nil && len(saved.Pending) <= 10000 && len(saved.Recent) <= 1000 && len(saved.Completed) <= 64 && len(saved.Native.Bans) <= 10000 && len(saved.Native.Failures) <= 5000 {
				if saved.Policy.BlockHash == "" || verifyPrefixes(saved.Prefixes, saved.Policy.BlockHash) == nil {
					state = saved
				}
			}
		}
	}
	state.Native.initialize()
	collector := collector{Cursor: state.Cursor}
	guard := banGuard{Name: "ddnezha-ssh-" + key, Dir: dir, Root: "/etc/fail2ban", Exec: run}
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
						if status.Existing != nil && (state.Migration == nil || !state.Migration.Complete) {
							target := guard
							target.Reused = true
							commandErr = target.unban(ctx, cmd.IP)
						}
						if commandErr == nil {
							previous := state.Native.clone()
							commandErr = state.Native.unban(cmd.IP)
							effective := effectivePolicy(state.Policy, state.Migration)
							if commandErr == nil {
								commandErr = save()
							}
							if commandErr == nil {
								commandErr = black.apply(ctx, effective, state.Prefixes, state.Native.active(effective))
							}
							if commandErr != nil {
								state.Native = previous
								_ = save()
								_ = black.apply(ctx, effective, state.Prefixes, state.Native.active(effective))
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
		p := effectivePolicy(state.Policy, state.Migration)
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
			if e := privateDir(dir); e != nil {
				status.Message = "无法保存监测状态"
			} else {
				var applyErr error
				if p.Enabled && p.AutoBan && (status.Existing != nil || state.Migration != nil) {
					migration, e := guard.prepareMigration(ctx)
					if e != nil {
						applyErr = e
					} else if migration != nil {
						state.Migration = migration
						if migration.PolicyRevision == 0 {
							migration.PolicyRevision = p.Revision
						}
						applyErr = guard.cutover(ctx, migration, func(m *migrationSnapshot) error {
							for ip, until := range m.Bans {
								old, exists := state.Native.Bans[ip]
								if !exists || until == -1 || (old != -1 && until > old) {
									state.Native.Bans[ip] = until
									state.Native.BanStarts[ip] = m.BanStarts[ip]
								}
							}
							effective := effectivePolicy(p, m)
							state.Native.prune(effective, time.Now())
							if e := save(); e != nil {
								return e
							}
							if e := black.apply(ctx, effective, state.Prefixes, state.Native.active(effective)); e != nil {
								return e
							}
							actual, e := black.banned()
							if e != nil {
								return e
							}
							for ip, until := range state.Native.Bans {
								if until != -1 && until <= time.Now().UnixMilli() {
									continue
								}
								if !slices.Contains(actual, ip) {
									return fmt.Errorf("原有封禁迁移校验失败，旧防护继续保留")
								}
							}
							return nil
						})
						p = effectivePolicy(p, migration)
						dirty = true
					}
				}
				if applyErr == nil {
					applyErr = black.apply(ctx, p, state.Prefixes, state.Native.active(p))
				}
				if applyErr != nil {
					status.Message = applyErr.Error()
				}
				status.BlockReady = applyErr == nil && black.Ready
				status.BlockHash = black.Hash
				status.Migrated = state.Migration != nil && state.Migration.Complete
				if status.Migrated || status.Existing == nil {
					bans, e := black.banned()
					status.BanReady = e == nil && applyErr == nil
					if e == nil {
						status.Banned = bans[:min(1000, len(bans))]
						status.BanTotal = len(bans)
					} else {
						status.Message = "本机封禁状态读取失败"
					}
				} else {
					probe := banGuard{Name: guard.Name, Reused: true, Ready: true, Exec: run}
					status.Banned = probe.banned(ctx)
					status.BanReady = probe.Ready
				}
			}
			nextApply = now.Add(10 * time.Second)
		}
		if !state.Active && status.Existing != nil {
			probe := banGuard{Name: guard.Name, Reused: true, Ready: true, Exec: run}
			status.Banned = probe.banned(ctx)
			status.BanReady = probe.Ready
		}
		ports, peers := sockets(ctx)
		slices.Sort(ports)
		if !slices.Equal(ports, lastPorts) {
			stableSince = now
			lastPorts = append([]uint16{}, ports...)
		}
		status.Ports = ports
		if p.Enabled {
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
					beforeCount := len(state.Native.Bans)
					if e := state.Native.observe(p, event, now); e != nil {
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
						state.Recent = oldRecent
						state.Native = oldNative
						state.Dropped = oldDropped
						status.Message = "无法保存本机登录记录"
					}
				}
			}
			status.Source = collector.Cursor.Source
		} else if collector.Cursor.Started {
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
		status.Revision = p.Revision
		status.ReceivedHash = p.BlockHash
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
