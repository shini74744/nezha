package sshlogin

import (
	"context"
	"fmt"
	"net/netip"
	"slices"
	"time"
)

func (s *savedState) applied() Policy {
	if s.AppliedPolicy != nil {
		return *s.AppliedPolicy
	}
	return s.Policy
}
func mergeNativeEntries(n *nativeState, entries []BanEntry) {
	n.initialize()
	for _, v := range entries {
		old, ok := n.Bans[v.IP]
		if !ok || v.ExpiresAt == -1 || (old != -1 && v.ExpiresAt > old) {
			n.Bans[v.IP] = v.ExpiresAt
			n.BanStarts[v.IP] = v.BannedAt
		}
	}
}
func verifyNativeBans(b *blacklistGuard, n nativeState, p Policy) error {
	if !p.Enabled || !p.AutoBan {
		return nil
	}
	ips, e := b.banned()
	if e != nil {
		return e
	}
	for ip, until := range n.Bans {
		a, _ := netip.ParseAddr(ip)
		if p.allowed(a) || (until > 0 && until <= time.Now().UnixMilli()) {
			continue
		}
		if !slices.Contains(ips, ip) {
			return fmt.Errorf("封禁迁移校验失败，原防护保留")
		}
	}
	return nil
}
func applyNativeBackend(ctx context.Context, s *savedState, g *banGuard, b *blacklistGuard, p Policy, save func() error) error {
	if e := g.checkFB5Ports(p); e != nil {
		return e
	}
	fromFB5 := s.applied().Engine() == "fail2ban"
	if fromFB5 && s.applied().Enabled && s.applied().AutoBan {
		// Freeze this jail while taking the migration snapshot. A failed
		// cutover resumes it; already installed kernel bans stay in place.
		if _, e := g.Exec(ctx, "fail2ban-client", "set", g.Name, "idle", "on"); e != nil {
			return fmt.Errorf("原 Fail2ban 防护暂时无法同步，切换已停止")
		}
		defer g.Exec(context.WithoutCancel(ctx), "fail2ban-client", "set", g.Name, "idle", "off")
		// Paging may reuse a short snapshot, but cutover must read current bans.
		g.invalidateFB5Cache()
		entries, e := g.readFB5Bans(ctx, time.Now())
		if e != nil {
			return fmt.Errorf("原 Fail2ban 封禁无法读取，切换已停止")
		}
		s.Native = nativeState{}
		mergeNativeEntries(&s.Native, entries)
	}
	if p.Enabled && p.AutoBan {
		existing := g.existing(ctx)
		if existing != nil || s.Migration != nil {
			m, e := g.prepareMigration(ctx)
			if e != nil {
				return e
			}
			if m != nil {
				s.Migration = m
				if m.PolicyRevision == 0 {
					m.PolicyRevision = p.Revision
				}
				if e = g.cutover(ctx, m, func(m *migrationSnapshot) error {
					mergeNativeEntries(&s.Native, func() []BanEntry {
						out := []BanEntry{}
						for ip, until := range m.Bans {
							out = append(out, BanEntry{IP: ip, ExpiresAt: until, BannedAt: m.BanStarts[ip]})
						}
						return out
					}())
					effective := effectivePolicy(p, m)
					s.Native.prune(effective, time.Now())
					if e := save(); e != nil {
						return e
					}
					if e := b.apply(ctx, effective, s.Prefixes, s.Native.active(effective)); e != nil {
						return e
					}
					return verifyNativeBans(b, s.Native, effective)
				}); e != nil {
					return e
				}
				p = effectivePolicy(p, m)
			}
		}
	}
	s.Native.prune(p, time.Now())
	if e := b.apply(ctx, p, s.Prefixes, s.Native.active(p)); e != nil {
		return e
	}
	if fromFB5 {
		if e := verifyNativeBans(b, s.Native, p); e != nil {
			return e
		}
		if e := g.disableFB5(ctx); e != nil {
			off := p
			off.Enabled = false
			off.BlockHash = ""
			_ = b.apply(context.WithoutCancel(ctx), off, nil, nil)
			return e
		}
	}
	return nil
}
func applyFB5Backend(ctx context.Context, s *savedState, g *banGuard, b *blacklistGuard, p Policy, source string, save func() error) (result error) {
	fromNative := s.applied().Engine() != "fail2ban"
	defer func() {
		if result != nil && fromNative {
			if e := g.disableFB5(context.WithoutCancel(ctx)); e != nil {
				result = fmt.Errorf("%v；新 Fail2ban 防护未能退出，请检查本机状态", result)
			}
		}
	}()
	if !p.Enabled {
		if e := g.disableFB5(ctx); e != nil {
			return e
		}
	} else {
		if e := g.configureFB5(ctx, p, s.Prefixes, source); e != nil {
			return e
		}
		if s.applied().Engine() != "fail2ban" {
			if e := g.importFB5Bans(ctx, p, banEntries(s.Native)); e != nil {
				return e
			}
		}
		var existing *ExistingSSH
		if p.AutoBan {
			existing = g.existing(ctx)
		}
		if existing != nil {
			m, e := g.prepareMigration(ctx)
			if e != nil {
				return e
			}
			if m != nil {
				s.Migration = m
				if m.PolicyRevision == 0 {
					m.PolicyRevision = p.Revision
				}
				if e = g.cutover(ctx, m, func(m *migrationSnapshot) error {
					merged := nativeState{}
					mergeNativeEntries(&merged, banEntries(s.Native))
					for ip, until := range m.Bans {
						mergeNativeEntries(&merged, []BanEntry{{IP: ip, ExpiresAt: until, BannedAt: m.BanStarts[ip]}})
					}
					if e := g.importFB5Bans(ctx, p, banEntries(merged)); e != nil {
						return e
					}
					return save()
				}); e != nil {
					return e
				}
			}
		}
	}
	// This is the only native operation during cutover: remove only this instance's
	// verified owned table. Steady-state Fail2ban never invokes the native backend.
	applied := s.applied()
	hadNative := b.HadRules || (fromNative && applied.Enabled && (applied.AutoBan || applied.WhitelistOnly || applied.BlockHash != ""))
	if hadNative {
		// After an interrupted state save, the last applied policy may be more
		// reliable than HadRules. Inspect ownership before removing anything.
		b.HadRules = true
		off := p
		off.Enabled = false
		off.BlockHash = ""
		if e := b.apply(ctx, off, nil, nil); e != nil {
			return fmt.Errorf("原生 SSH 规则尚未退出，切换未完成")
		}
	}
	return nil
}
