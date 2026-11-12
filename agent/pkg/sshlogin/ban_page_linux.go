package sshlogin

import (
	"context"
	"fmt"
	"net/netip"
	"slices"
	"strings"
	"time"
)

func parseTimedBanStarts(raw string) map[string]int64 {
	out := map[string]int64{}
	for _, line := range strings.Split(strings.TrimSpace(raw), "\n") {
		m := timedBanLine.FindStringSubmatch(strings.TrimSpace(line))
		if m == nil {
			continue
		}
		ip, e := netip.ParseAddr(m[1])
		if e != nil || ip.Zone() != "" {
			continue
		}
		at, e := time.ParseInLocation("2006-01-02 15:04:05", m[2], time.Local)
		if e == nil {
			out[ip.Unmap().String()] = at.UnixMilli()
		}
	}
	return out
}
func paginateBans(entries []BanEntry, query BanQuery, now time.Time) BanPage {
	page := BanPage{QueryID: query.ID, Items: []BanEntry{}, Page: query.Page, PageSize: query.PageSize, ObservedAt: now.UnixMilli(), Complete: true}
	if query.ID == 0 || len(query.Search) > 64 || query.Page < 1 || query.Page > 10000 || (query.PageSize != 10 && query.PageSize != 20 && query.PageSize != 50 && query.PageSize != 100) {
		page.Error = "查询条件无效"
		return page
	}
	search := strings.ToLower(strings.TrimSpace(query.Search))
	filtered := make([]BanEntry, 0, len(entries))
	for _, entry := range entries {
		if strings.Contains(strings.ToLower(entry.IP), search) {
			filtered = append(filtered, entry)
		}
	}
	parsed := make(map[string]netip.Addr, len(filtered))
	for _, entry := range filtered {
		parsed[entry.IP], _ = netip.ParseAddr(entry.IP)
	}
	slices.SortFunc(filtered, func(a, b BanEntry) int {
		if a.BannedAt > b.BannedAt {
			return -1
		}
		if a.BannedAt < b.BannedAt {
			return 1
		}
		return parsed[a.IP].Compare(parsed[b.IP])
	})
	page.Total = len(filtered)
	last := max(1, (len(filtered)+query.PageSize-1)/query.PageSize)
	page.Page = min(query.Page, last)
	start := (page.Page - 1) * query.PageSize
	page.Items = append(page.Items, filtered[start:min(start+query.PageSize, len(filtered))]...)
	return page
}
func readBanPage(ctx context.Context, q BanQuery, st Status, g banGuard, b blacklistGuard, n nativeState, now time.Time) BanPage {
	entries := []BanEntry{}
	var err error
	if st.Backend == "fail2ban" {
		if st.AutoBanActive {
			entries, err = g.readFB5Bans(ctx, now)
		}
	} else if st.Existing != nil && !st.Migrated {
		var raw []byte
		raw, err = g.Exec(ctx, "fail2ban-client", "get", "sshd", "banip", "--with-time")
		if err == nil {
			var bans map[string]int64
			bans, err = parseTimedBans(string(raw), now)
			starts := parseTimedBanStarts(string(raw))
			for ip, until := range bans {
				entries = append(entries, BanEntry{IP: ip, BannedAt: starts[ip], ExpiresAt: until})
			}
		}
	} else {
		var ips []string
		ips, err = b.banned()
		for _, ip := range ips {
			entries = append(entries, BanEntry{IP: ip, BannedAt: n.BanStarts[ip], ExpiresAt: n.Bans[ip]})
		}
	}
	page := paginateBans(entries, q, now)
	if err != nil {
		page.Items = []BanEntry{}
		page.Total = 0
		page.Error = fmt.Sprint("本机封禁列表读取失败，请稍后重试")
	}
	return page
}
