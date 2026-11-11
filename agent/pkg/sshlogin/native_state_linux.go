package sshlogin

import (
	"fmt"
	"net/netip"
	"slices"
	"time"
)

type nativeState struct {
	BanStarts map[string]int64
	Failures  map[string][]int64
	Bans      map[string]int64
}

func (p Policy) allowed(ip netip.Addr) bool {
	ip = ip.Unmap()
	if ip.IsLoopback() {
		return true
	}
	for _, raw := range p.Allowlist {
		if a, e := netip.ParseAddr(raw); e == nil && a.Unmap() == ip {
			return true
		}
		if prefix, e := netip.ParsePrefix(raw); e == nil && prefix.Contains(ip) {
			return true
		}
	}
	return false
}
func (s *nativeState) initialize() {
	if s.BanStarts == nil {
		s.BanStarts = map[string]int64{}
	}
	if s.Failures == nil {
		s.Failures = map[string][]int64{}
	}
	if s.Bans == nil {
		s.Bans = map[string]int64{}
	}
}
func (s *nativeState) prune(p Policy, now time.Time) {
	s.initialize()
	for ip, list := range s.Failures {
		kept := list[:0]
		for _, at := range list {
			if at > now.Add(-time.Duration(p.FindTime)*time.Second).UnixMilli() && at <= now.Add(5*time.Minute).UnixMilli() {
				kept = append(kept, at)
			}
		}
		if len(kept) == 0 {
			delete(s.Failures, ip)
		} else {
			s.Failures[ip] = kept
		}
	}
	for ip, until := range s.Bans {
		a, e := netip.ParseAddr(ip)
		if e != nil || (until > 0 && until <= now.UnixMilli()) || p.allowed(a) {
			delete(s.Bans, ip)
		}
	}
	for ip := range s.BanStarts {
		if _, ok := s.Bans[ip]; !ok {
			delete(s.BanStarts, ip)
		}
	}
}
func (s *nativeState) observe(p Policy, e Event, now time.Time) error {
	s.prune(p, now)
	if !p.Protected(e) || e.Time < now.Add(-time.Duration(p.FindTime)*time.Second).UnixMilli() || e.Time > now.Add(5*time.Minute).UnixMilli() {
		return nil
	}
	if _, exists := s.Bans[e.SourceIP]; exists {
		return nil
	}
	if _, exists := s.Failures[e.SourceIP]; !exists && len(s.Failures) >= 5000 {
		return fmt.Errorf("失败计数已达上限，请检查本机登录日志")
	}
	total := 0
	for _, v := range s.Failures {
		total += len(v)
	}
	if total >= 100000 {
		return fmt.Errorf("失败记录过多，请检查本机登录日志")
	}
	s.Failures[e.SourceIP] = append(s.Failures[e.SourceIP], e.Time)
	if len(s.Failures[e.SourceIP]) < p.MaxRetry {
		return nil
	}
	if len(s.Bans) >= 10000 {
		return fmt.Errorf("封禁数量已达上限，请检查本机防护状态")
	}
	until := int64(-1)
	if p.BanTime != -1 {
		until = now.Add(time.Duration(p.BanTime) * time.Second).UnixMilli()
	}
	s.Bans[e.SourceIP] = until
	s.BanStarts[e.SourceIP] = now.UnixMilli()
	delete(s.Failures, e.SourceIP)
	return nil
}
func (s *nativeState) unban(ip string) error {
	a, e := netip.ParseAddr(ip)
	if e != nil || a.Zone() != "" {
		return fmt.Errorf("无效 IP")
	}
	delete(s.Bans, a.Unmap().String())
	delete(s.BanStarts, a.Unmap().String())
	delete(s.Failures, a.Unmap().String())
	return nil
}
func (s nativeState) active(p Policy) map[string]int64 {
	if !p.Enabled || !p.AutoBan {
		return map[string]int64{}
	}
	return s.Bans
}
func sourceBlocked(p Policy, prefixes []string, raw string) bool {
	ip, e := netip.ParseAddr(raw)
	if e != nil {
		return false
	}
	ip = ip.Unmap()
	if p.allowed(ip) {
		return false
	}
	if p.WhitelistOnly {
		return true
	}
	for _, raw := range prefixes {
		if prefix, e := netip.ParsePrefix(raw); e == nil && prefix.Contains(ip) {
			return true
		}
	}
	return false
}
func mergeAllowed(first, second []string) []string {
	out := append(append([]string{}, first...), second...)
	slices.Sort(out)
	return slices.Compact(out)
}

func (s nativeState) clone() nativeState {
	copy := nativeState{BanStarts: map[string]int64{}, Failures: map[string][]int64{}, Bans: map[string]int64{}}
	for ip, times := range s.Failures {
		copy.Failures[ip] = append([]int64{}, times...)
	}
	for ip, until := range s.Bans {
		copy.Bans[ip] = until
	}
	for ip, at := range s.BanStarts {
		copy.BanStarts[ip] = at
	}
	return copy
}
