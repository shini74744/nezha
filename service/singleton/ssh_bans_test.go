package singleton

import (
	"context"
	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func TestSSHBanQueryBindsNodeAndQueryAndReturnsWholePage(t *testing.T) {
	now := time.Now()
	observeSSHLocal("ban-a", model.SSHLoginReport{Status: model.SSHLoginStatus{BanPaging: true}}, now)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second*3)
	defer cancel()
	done := make(chan model.SSHBanPage, 1)
	errs := make(chan error, 1)
	go func() { p, e := ReadSSHLocalBans(ctx, "ban-a", "198.18.", 51, 20); done <- p; errs <- e }()
	var q *model.SSHBanQuery
	require.Eventually(t, func() bool { q = observeSSHBans("ban-a", nil, now); return q != nil }, time.Second, time.Millisecond)
	require.Equal(t, 51, q.Page)
	require.Equal(t, "198.18.", q.Search)
	p := model.SSHBanPage{QueryID: q.ID, Items: []model.SSHBanEntry{{IP: "198.18.0.1", BannedAt: now.UnixMilli(), ExpiresAt: -1}}, Total: 1001, Page: 51, PageSize: 20, Complete: true}
	observeSSHBans("ban-other", &p, now)
	select {
	case <-done:
		t.Fatal("cross-node response accepted")
	default:
	}
	p.QueryID++
	observeSSHBans("ban-a", &p, now)
	select {
	case <-done:
		t.Fatal("stale response accepted")
	default:
	}
	p.QueryID = q.ID
	observeSSHBans("ban-a", &p, now)
	require.NoError(t, <-errs)
	actual := <-done
	require.Equal(t, 1001, actual.Total)
	require.Equal(t, p.Items, actual.Items)
}
func TestSSHBanPageValidationAndOldAgent(t *testing.T) {
	p := model.SSHBanPage{QueryID: 1, Items: []model.SSHBanEntry{{IP: "192.0.2.1", ExpiresAt: -1}}, Page: 1, PageSize: 20, Total: 1}
	require.NoError(t, validateSSHBanPage(&p))
	p.Items = append(p.Items, p.Items[0])
	require.Error(t, validateSSHBanPage(&p))
	p.Items = nil
	p.Total = 10001
	require.Error(t, validateSSHBanPage(&p))
	observeSSHLocal("old-ban-agent", model.SSHLoginReport{Status: model.SSHLoginStatus{BanReady: true, Banned: []string{"192.0.2.1"}}}, time.Now())
	result, e := ReadSSHLocalBans(context.Background(), "old-ban-agent", "192.0.2", 1, 20)
	require.NoError(t, e)
	require.False(t, result.Complete)
	require.Zero(t, result.Items[0].BannedAt)
	_, e = ReadSSHLocalBans(context.Background(), "unknown-ban-agent", "", 1, 20)
	require.Error(t, e)
	_, e = ReadSSHLocalBans(context.Background(), "old-ban-agent", "", 0, 20)
	require.Error(t, e)
}
