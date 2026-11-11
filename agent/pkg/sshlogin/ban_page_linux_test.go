package sshlogin

import (
	"encoding/json"
	"fmt"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func TestBanPagesSearchBeyondLegacyLimitAndClamp(t *testing.T) {
	now := time.Now()
	entries := []BanEntry{}
	for i := 0; i < 1005; i++ {
		entries = append(entries, BanEntry{IP: fmt.Sprintf("198.18.%d.%d", i/256, i%256), BannedAt: int64(i), ExpiresAt: -1})
	}
	q := BanQuery{ID: 1, Page: 1, PageSize: 20}
	p := paginateBans(entries, q, now)
	require.Equal(t, 1005, p.Total)
	require.Len(t, p.Items, 20)
	require.Equal(t, entries[1004], p.Items[0])
	q.Search = entries[1004].IP
	p = paginateBans(entries, q, now)
	require.Equal(t, 1, p.Total)
	require.Equal(t, entries[1004], p.Items[0])
	q.Search = ""
	q.Page = 99
	p = paginateBans(entries, q, now)
	require.Equal(t, 51, p.Page)
	require.Len(t, p.Items, 5)
	q.PageSize = 1000
	require.NotEmpty(t, paginateBans(entries, q, now).Error)
	q.PageSize = 20
	q.Search = "none"
	p = paginateBans(entries, q, now)
	require.Empty(t, p.Items)
	require.Equal(t, 1, p.Page)
}
func TestBanStartPersistsAndOldStateNeverInventsTime(t *testing.T) {
	now := time.Now()
	p := initialPolicy()
	p.Enabled = true
	p.AutoBan = true
	p.MaxRetry = 1
	n := nativeState{}
	e := Event{SourceIP: "192.0.2.11", Port: 22, Time: now.UnixMilli()}
	require.NoError(t, n.observe(p, e, now))
	require.Equal(t, now.UnixMilli(), n.BanStarts[e.SourceIP])
	raw, err := json.Marshal(n)
	require.NoError(t, err)
	var restored nativeState
	require.NoError(t, json.Unmarshal(raw, &restored))
	restored.initialize()
	require.Equal(t, n.BanStarts, restored.BanStarts)
	clone := restored.clone()
	require.NoError(t, clone.unban(e.SourceIP))
	require.NotEmpty(t, restored.BanStarts)
	require.Empty(t, clone.BanStarts)
	restored.prune(p, now.Add(time.Hour*2))
	require.Empty(t, restored.BanStarts)
	var old nativeState
	require.NoError(t, json.Unmarshal([]byte(`{"Bans":{"192.0.2.1":-1}}`), &old))
	old.initialize()
	require.Zero(t, old.BanStarts["192.0.2.1"])
}
func TestLegacyBanStartsUseOriginalTimestamp(t *testing.T) {
	raw := "192.0.2.1 2026-11-01 12:00:00 + 3600 = 2026-11-01 13:00:00\n2001:db8::1 2026-11-01 11:00:00 + -1 = permanent"
	starts := parseTimedBanStarts(raw)
	at, _ := time.ParseInLocation("2006-01-02 15:04:05", "2026-11-01 12:00:00", time.Local)
	require.Equal(t, at.UnixMilli(), starts["192.0.2.1"])
	require.Greater(t, starts["2001:db8::1"], int64(0))
}
