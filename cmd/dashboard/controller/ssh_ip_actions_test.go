package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestSSHIPQuickActionsAreAtomicScopedAndPreserveSettings(t *testing.T) {
	defer setupTenancyTest(t)()
	require.NoError(t, singleton.DB.AutoMigrate(&model.SSHLoginPolicy{}, &model.SSHUnbanCommand{}, &model.Server{}))
	require.NoError(t, singleton.DB.Create(&model.Server{Common: model.Common{ID: 701}, UUID: "quick-a"}).Error)
	p := model.DefaultSSHLoginPolicy()
	p.UUID = "quick-a"
	p.Revision = 3
	p.Ports = []uint16{2222}
	p.BlockIPs = []string{"192.0.2.10", "198.51.100.0/24"}
	p.BlockTimes = map[string]int64{"192.0.2.10": 1234, "198.51.100.0/24": 5678}
	require.NoError(t, singleton.DB.Create(&p).Error)
	action := func(ip, kind string, revision uint64) error {
		_, e := sshLoginIPAction(ctxAsMemberWithBody(1, map[string]any{"server_id": 701, "ip": ip, "action": kind, "revision": revision}))
		return e
	}
	require.NoError(t, action("::ffff:192.0.2.10", "whitelist", 3))
	got, e := singleton.SSHLoginPolicyFor("quick-a")
	require.NoError(t, e)
	require.Equal(t, []string{"192.0.2.10"}, got.Allowlist)
	require.Equal(t, []string{"198.51.100.0/24"}, got.BlockIPs)
	require.Equal(t, []uint16{2222}, got.Ports)
	require.Equal(t, int64(5678), got.BlockTimes["198.51.100.0/24"])
	var cmds []model.SSHUnbanCommand
	require.NoError(t, singleton.DB.Find(&cmds).Error)
	require.Len(t, cmds, 1)
	require.Equal(t, "quick-a", cmds[0].UUID)
	require.Error(t, action("192.0.2.10", "blacklist", 3))
	require.NoError(t, action("192.0.2.10", "whitelist", 4))
	require.NoError(t, singleton.DB.Find(&cmds).Error)
	require.Len(t, cmds, 1)
	require.NoError(t, action("192.0.2.10", "blacklist", 5))
	got, e = singleton.SSHLoginPolicyFor("quick-a")
	require.NoError(t, e)
	require.Empty(t, got.Allowlist)
	require.Contains(t, got.BlockIPs, "192.0.2.10")
	require.Greater(t, got.BlockTimes["192.0.2.10"], int64(1234))
	got.Allowlist = []string{"192.0.2.0/24"}
	require.NoError(t, singleton.DB.Save(&got).Error)
	require.ErrorContains(t, action("192.0.2.10", "blacklist", 6), "白名单网段")
	for _, ip := range []string{";reboot", "192.0.2.0/24", "fe80::1%eth0", "0.0.0.0"} {
		require.Error(t, action(ip, "blacklist", 6))
	}
	tok := &model.APIToken{ScopesCSV: model.ScopeAdminAll}
	tok.SetServerIDs([]uint64{702})
	c, _ := patRequestCtx(t, tok, 1, "POST", "/ssh-login/ip-action", map[string]any{"server_id": 701, "ip": "192.0.2.10", "action": "whitelist", "revision": 6})
	_, e = sshLoginIPAction(c)
	require.Error(t, e)
	c, _ = patRequestCtx(t, tok, 1, "GET", "/ssh-login/701/bans", nil)
	c.Params = gin.Params{{Key: "id", Value: "701"}}
	_, e = listSSHLoginBans(c)
	require.Error(t, e)
}
func TestSSHManualBanTimesCannotBeForgedBySaving(t *testing.T) {
	old := model.SSHLoginPolicy{BlockIPs: []string{"192.0.2.1", "2001:db8::/32"}, BlockTimes: map[string]int64{"192.0.2.1": 123}}
	p := model.SSHLoginPolicy{BlockIPs: []string{"192.0.2.1", "2001:db8::/32", "192.0.2.2"}, BlockTimes: map[string]int64{"192.0.2.1": 999}}
	p.KeepSSHBlockTimes(old, 456)
	require.Equal(t, int64(123), p.BlockTimes["192.0.2.1"])
	require.Zero(t, p.BlockTimes["2001:db8::/32"])
	require.Equal(t, int64(456), p.BlockTimes["192.0.2.2"])
}

func TestSSHQuickWhitelistQueueFailureRollsBackPolicy(t *testing.T) {
	defer setupTenancyTest(t)()
	require.NoError(t, singleton.DB.AutoMigrate(&model.SSHLoginPolicy{}, &model.SSHUnbanCommand{}, &model.Server{}))
	require.NoError(t, singleton.DB.Create(&model.Server{Common: model.Common{ID: 701}, UUID: "queue-full"}).Error)
	p := model.DefaultSSHLoginPolicy()
	p.UUID = "queue-full"
	p.Revision = 5
	p.BlockIPs = []string{"192.0.2.44"}
	require.NoError(t, singleton.DB.Create(&p).Error)
	for i := 0; i < 32; i++ {
		require.NoError(t, singleton.DB.Create(&model.SSHUnbanCommand{UUID: p.UUID, IP: "198.51.100.1"}).Error)
	}
	_, err := sshLoginIPAction(ctxAsMemberWithBody(1, map[string]any{"server_id": 701, "ip": "192.0.2.44", "action": "whitelist", "revision": 5}))
	require.Error(t, err)
	got, err := singleton.SSHLoginPolicyFor(p.UUID)
	require.NoError(t, err)
	require.Equal(t, p.Revision, got.Revision)
	require.Empty(t, got.Allowlist)
	require.Equal(t, p.BlockIPs, got.BlockIPs)
}
func TestSSHProtectionMayRunWithoutNotifications(t *testing.T) {
	defer setupTenancyTest(t)()
	require.NoError(t, singleton.DB.AutoMigrate(&model.SSHLoginPolicy{}, &model.Server{}, &model.Notification{}, &model.NotificationGroupNotification{}))
	require.NoError(t, singleton.DB.Create(&model.Server{Common: model.Common{ID: 701}, UUID: "defense-only"}).Error)
	p := model.DefaultSSHLoginPolicy()
	p.Enabled = true
	p.AutoBan = true
	p.Success = false
	p.Failure = false
	_, err := saveSSHLogin(ctxAsMemberWithBody(1, map[string]any{"server_ids": []uint64{701}, "policy": p}))
	require.NoError(t, err)
	got, err := singleton.SSHLoginPolicyFor("defense-only")
	require.NoError(t, err)
	require.True(t, got.Enabled)
	require.True(t, got.AutoBan)
	require.Zero(t, got.NotificationGroupID)
	p.Success = true
	_, err = saveSSHLogin(ctxAsMemberWithBody(1, map[string]any{"server_ids": []uint64{701}, "policy": p}))
	require.Error(t, err)
}
