package singleton

import (
	"context"
	"fmt"
	"github.com/nezhahq/nezha/model"
	"net/netip"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode"
)

type sshBanRequest struct {
	query   model.SSHBanQuery
	done    chan struct{}
	result  model.SSHBanPage
	expires time.Time
}

var sshBanLocal = struct {
	sync.Mutex
	requests map[string][]*sshBanRequest
}{requests: map[string][]*sshBanRequest{}}

func validateSSHBanPage(p *model.SSHBanPage) error {
	if p == nil {
		return nil
	}
	if p.QueryID == 0 || len(p.Items) > 100 || p.Total < 0 || p.Total > 10000 || p.Page < 1 || p.Page > 10000 || p.PageSize < 1 || p.PageSize > 100 || len(p.Items) > p.PageSize || len(p.Error) > 256 || strings.IndexFunc(p.Error, unicode.IsControl) >= 0 {
		return fmt.Errorf("invalid ban page")
	}
	seen := map[string]bool{}
	for _, v := range p.Items {
		a, e := netip.ParseAddr(v.IP)
		if e != nil || a.Zone() != "" || seen[a.Unmap().String()] || v.BannedAt < 0 || v.ExpiresAt < -1 {
			return fmt.Errorf("invalid ban entry")
		}
		seen[a.Unmap().String()] = true
	}
	return nil
}
func observeSSHBans(uuid string, page *model.SSHBanPage, now time.Time) *model.SSHBanQuery {
	sshBanLocal.Lock()
	defer sshBanLocal.Unlock()
	for key, list := range sshBanLocal.requests {
		kept := list[:0]
		for _, q := range list {
			if now.After(q.expires) {
				continue
			}
			if key == uuid && page != nil && q.query.ID == page.QueryID && page.PageSize == q.query.PageSize {
				q.result = *page
				q.result.Items = append([]model.SSHBanEntry{}, page.Items...)
				close(q.done)
				continue
			}
			kept = append(kept, q)
		}
		if len(kept) == 0 {
			delete(sshBanLocal.requests, key)
		} else {
			sshBanLocal.requests[key] = kept
		}
	}
	if list := sshBanLocal.requests[uuid]; len(list) > 0 {
		q := list[0].query
		return &q
	}
	return nil
}
func ReadSSHLocalBans(ctx context.Context, uuid, search string, page, size int) (model.SSHBanPage, error) {
	var empty model.SSHBanPage
	search = strings.TrimSpace(search)
	if len(search) > 64 || strings.IndexFunc(search, unicode.IsControl) >= 0 || page < 1 || page > 10000 || !slices.Contains([]int{10, 20, 50, 100}, size) {
		return empty, fmt.Errorf("查询条件无效")
	}
	st := SSHLoginStatusFor(uuid)
	if st.UpdatedAt == 0 || time.Now().Unix()-st.UpdatedAt > 45 {
		return empty, fmt.Errorf("Agent 暂未连接，无法读取封禁列表")
	}
	if !st.BanPaging {
		if !st.BanReady {
			return empty, fmt.Errorf("暂未读取到本机封禁状态")
		}
		entries := []model.SSHBanEntry{}
		for _, ip := range st.Banned {
			if strings.Contains(strings.ToLower(ip), strings.ToLower(search)) {
				entries = append(entries, model.SSHBanEntry{IP: ip})
			}
		}
		slices.SortFunc(entries, func(a, b model.SSHBanEntry) int { return strings.Compare(a.IP, b.IP) })
		actual := min(page, max(1, (len(entries)+size-1)/size))
		start := (actual - 1) * size
		return model.SSHBanPage{Items: entries[start:min(start+size, len(entries))], Total: len(entries), Page: actual, PageSize: size, ObservedAt: st.UpdatedAt * 1000, Complete: false}, nil
	}
	sshBanLocal.Lock()
	list := sshBanLocal.requests[uuid]
	var q *sshBanRequest
	kept := list[:0]
	for _, v := range list {
		if time.Now().Before(v.expires) {
			kept = append(kept, v)
			if v.query.Search == search && v.query.Page == page && v.query.PageSize == size {
				q = v
			}
		}
	}
	if q == nil {
		if len(kept) >= 8 {
			sshBanLocal.Unlock()
			return empty, fmt.Errorf("查询较多，请稍后重试")
		}
		q = &sshBanRequest{query: model.SSHBanQuery{ID: sshQuerySequence.Add(1), Search: search, Page: page, PageSize: size}, done: make(chan struct{}), expires: time.Now().Add(25 * time.Second)}
		kept = append(kept, q)
	}
	sshBanLocal.requests[uuid] = kept
	sshBanLocal.Unlock()
	timer := time.NewTimer(25 * time.Second)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return empty, ctx.Err()
	case <-timer.C:
		return empty, fmt.Errorf("读取封禁列表超时，请重试")
	case <-q.done:
		if q.result.Error != "" {
			return empty, fmt.Errorf("%s", q.result.Error)
		}
		return q.result, nil
	}
}
