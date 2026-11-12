package controller

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSSHAdminGuardAndScopedPolicySave(t *testing.T) {
	defer setupTenancyTest(t)()
	require.NoError(t, singleton.DB.AutoMigrate(&model.SSHLoginPolicy{}, &model.SSHUnbanCommand{}, &model.Server{}, &model.Notification{}, &model.NotificationGroupNotification{}))
	for _, s := range []*model.Server{{Common: model.Common{ID: 701}, UUID: "ssh-fixture-a", Name: "A"}, {Common: model.Common{ID: 702}, UUID: "ssh-fixture-b", Name: "B"}} {
		require.NoError(t, singleton.DB.Create(s).Error)
	}
	p := model.DefaultSSHLoginPolicy()
	p.Ports = []uint16{2222}
	p.Allowlist = []string{"192.0.2.0/24"}
	f := map[string]any{"server_ids": []uint64{701}, "policy": p}
	_, e := saveSSHLogin(ctxAsMemberWithBody(1, f))
	require.NoError(t, e)
	a, e := singleton.SSHLoginPolicyFor("ssh-fixture-a")
	require.NoError(t, e)
	require.Equal(t, []uint16{2222}, a.Ports)
	require.EqualValues(t, 1, a.Revision)
	b, e := singleton.SSHLoginPolicyFor("ssh-fixture-b")
	require.NoError(t, e)
	require.EqualValues(t, 0, b.Revision)
	require.Equal(t, []uint16{22}, b.Ports)
	f["server_ids"] = []uint64{701, 701}
	_, e = saveSSHLogin(ctxAsMemberWithBody(1, f))
	require.Error(t, e)
	f["server_ids"] = []uint64{701, 999999}
	_, e = saveSSHLogin(ctxAsMemberWithBody(1, f))
	require.Error(t, e)
	a, e = singleton.SSHLoginPolicyFor("ssh-fixture-a")
	require.NoError(t, e)
	require.EqualValues(t, 1, a.Revision)
	f["server_ids"] = []uint64{701}
	p.Enabled = true
	p.NotificationGroupID = 999999
	f["policy"] = p
	_, e = saveSSHLogin(ctxAsMemberWithBody(1, f))
	require.Error(t, e)
	for _, user := range []*model.User{nil, {Role: model.RoleMember}} {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		if user != nil {
			c.Set(model.CtxKeyAuthorizedUser, user)
		}
		invoked := false
		adminHandler(func(*gin.Context) (any, error) { invoked = true; return nil, nil })(c)
		require.False(t, invoked)
		require.Contains(t, w.Body.String(), "error")
	}
}
func TestSSHUnbanValidatesAddressAndBindsServer(t *testing.T) {
	defer setupTenancyTest(t)()
	require.NoError(t, singleton.DB.AutoMigrate(&model.SSHUnbanCommand{}, &model.Server{}))
	require.NoError(t, singleton.DB.Create(&model.Server{Common: model.Common{ID: 701}, UUID: "ssh-fixture-a"}).Error)
	for _, ip := range []string{"", "192.0.2.1; reboot", "$(id)", "2001:db8::1%eth0", "192.0.2.0/24"} {
		_, e := unbanSSHLogin(ctxAsMemberWithBody(1, map[string]any{"server_id": 701, "ip": ip}))
		require.Error(t, e)
	}
	_, e := unbanSSHLogin(ctxAsMemberWithBody(1, map[string]any{"server_id": 701, "ip": "::ffff:192.0.2.1", "uuid": "another-node"}))
	require.NoError(t, e)
	var commands []model.SSHUnbanCommand
	require.NoError(t, singleton.DB.Find(&commands).Error)
	require.Len(t, commands, 1)
	require.Equal(t, "ssh-fixture-a", commands[0].UUID)
	require.Equal(t, "192.0.2.1", commands[0].IP)
}
func TestSSHRouteRequiresAdminScope(t *testing.T) {
	// Exercise the same scope middleware used by every SSH read/write endpoint.
	for _, method := range []string{"GET", "PUT", "POST"} {
		defer setupTenancyTest(t)()
		r := gin.New()
		r.Use(func(c *gin.Context) { c.Set(apiTokenCtxKey, &model.APIToken{ScopesCSV: "nezha:server:read"}) })
		invoked := false
		r.Handle(method, "/ssh-login", restScopeMiddleware(model.ScopeAdminAll), func(c *gin.Context) { invoked = true; c.Status(200) })
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(method, "/ssh-login", strings.NewReader("{}")))
		require.False(t, invoked)
		require.Equal(t, 403, w.Code)
	}
}

func TestSSHAdminPATRemainsRestrictedToSelectedNodes(t *testing.T) {
	defer setupTenancyTest(t)()
	require.NoError(t, singleton.DB.AutoMigrate(&model.SSHLoginPolicy{}, &model.SSHUnbanCommand{}, &model.Server{}))
	for _, s := range []*model.Server{{Common: model.Common{ID: 701}, UUID: "ssh-a"}, {Common: model.Common{ID: 702}, UUID: "ssh-b"}} {
		require.NoError(t, singleton.DB.Create(s).Error)
	}
	tok := &model.APIToken{ScopesCSV: model.ScopeAdminAll}
	tok.SetServerIDs([]uint64{701})
	c, _ := patRequestCtx(t, tok, 1, "GET", "/ssh-login", nil)
	rows, e := listSSHLogin(c)
	require.NoError(t, e)
	require.Len(t, rows, 1)
	require.EqualValues(t, 701, rows[0].ID)
	p := model.DefaultSSHLoginPolicy()
	c, _ = patRequestCtx(t, tok, 1, "PUT", "/ssh-login", map[string]any{"server_ids": []uint64{701, 702}, "policy": p})
	_, e = saveSSHLogin(c)
	require.Error(t, e)
	var count int64
	require.NoError(t, singleton.DB.Model(&model.SSHLoginPolicy{}).Count(&count).Error)
	require.Zero(t, count)
	c, _ = patRequestCtx(t, tok, 1, "POST", "/ssh-login/unban", map[string]any{"server_id": 702, "ip": "192.0.2.10"})
	_, e = unbanSSHLogin(c)
	require.Error(t, e)
	c, _ = patRequestCtx(t, tok, 1, "GET", "/ssh-login/702/events", nil)
	c.Params = gin.Params{{Key: "id", Value: "702"}}
	_, e = listSSHLoginEvents(c)
	require.Error(t, e)
}
func TestSSHUnbanRetriesAreIdempotentAndBounded(t *testing.T) {
	defer setupTenancyTest(t)()
	require.NoError(t, singleton.DB.AutoMigrate(&model.SSHUnbanCommand{}, &model.Server{}))
	require.NoError(t, singleton.DB.Create(&model.Server{Common: model.Common{ID: 701}, UUID: "ssh-a"}).Error)
	for i := 0; i < 3; i++ {
		_, e := unbanSSHLogin(ctxAsMemberWithBody(1, map[string]any{"server_id": 701, "ip": "192.0.2.10"}))
		require.NoError(t, e)
	}
	var count int64
	require.NoError(t, singleton.DB.Model(&model.SSHUnbanCommand{}).Count(&count).Error)
	require.EqualValues(t, 1, count)
}

func TestSSHBackendSaveRequiresCapabilityAndPreservesPolicy(t *testing.T) {
	defer setupTenancyTest(t)()
	require.NoError(t, singleton.DB.AutoMigrate(&model.SSHLoginPolicy{}, &model.SSHUnbanCommand{}, &model.Server{}, &model.SSHLoginEvent{}, &model.SSHLoginReceipt{}))
	server := &model.Server{Common: model.Common{ID: 703}, UUID: "ssh-backend-fixture", Name: "fixture"}
	require.NoError(t, singleton.DB.Create(server).Error)
	p := model.DefaultSSHLoginPolicy()
	p.Backend = "fail2ban"
	p.Success = false
	p.Failure = false
	p.Ports = []uint16{2222}
	p.Allowlist = []string{"192.0.2.1"}
	p.WhitelistOnly = true
	f := map[string]any{"server_ids": []uint64{703}, "policy": p}
	_, e := saveSSHLogin(ctxAsMemberWithBody(1, f))
	require.Error(t, e)
	stored, e := singleton.SSHLoginPolicyFor(server.UUID)
	require.NoError(t, e)
	require.EqualValues(t, 0, stored.Revision)
	_, e = singleton.ReceiveSSHLogin(server.UUID, model.SSHLoginReport{Status: model.SSHLoginStatus{BackendSelection: true, Backend: "native"}}, time.Now())
	require.NoError(t, e)
	_, e = saveSSHLogin(ctxAsMemberWithBody(1, f))
	require.NoError(t, e)
	stored, e = singleton.SSHLoginPolicyFor(server.UUID)
	require.NoError(t, e)
	require.Equal(t, "fail2ban", stored.Backend)
	require.Equal(t, p.Ports, stored.Ports)
	require.Equal(t, p.Allowlist, stored.Allowlist)
	require.True(t, stored.WhitelistOnly)

	_, e = singleton.ReceiveSSHLogin(server.UUID, model.SSHLoginReport{Status: model.SSHLoginStatus{BackendSelection: true, Backend: "fail2ban"}}, time.Now().Add(-time.Minute))
	require.NoError(t, e)
	_, e = saveSSHLogin(ctxAsMemberWithBody(1, f))
	require.NoError(t, e, "existing Fail2ban configuration remains editable offline")
	p.Backend = "native"
	f["policy"] = p
	_, e = saveSSHLogin(ctxAsMemberWithBody(1, f))
	require.NoError(t, e)
	stored, e = singleton.SSHLoginPolicyFor(server.UUID)
	require.NoError(t, e)
	require.Equal(t, "native", stored.Backend)
	require.Equal(t, p.Allowlist, stored.Allowlist)
}

func TestSSHListUsesBoundedBatchAndOptionalSummary(t *testing.T) {
	defer setupTenancyTest(t)()
	require.NoError(t, singleton.DB.AutoMigrate(&model.SSHLoginPolicy{}, &model.Server{}))
	for i := 1; i <= 120; i++ {
		server := model.Server{Common: model.Common{ID: uint64(i)}, UUID: fmt.Sprintf("ssh-speed-%d", i), Name: fmt.Sprint(i)}
		require.NoError(t, singleton.DB.Create(&server).Error)
		if i%2 == 0 {
			p := model.DefaultSSHLoginPolicy()
			p.UUID = server.UUID
			p.Backend = "fail2ban"
			require.NoError(t, singleton.DB.Create(&p).Error)
		}
	}
	queries := 0
	name := "test:ssh-list-query-count"
	require.NoError(t, singleton.DB.Callback().Query().Before("gorm:query").Register(name, func(*gorm.DB) { queries++ }))
	defer singleton.DB.Callback().Query().Remove(name)
	tok := &model.APIToken{ScopesCSV: model.ScopeAdminAll}
	c, _ := patRequestCtx(t, tok, 1, "GET", "/ssh-login?summary=1", nil)
	rows, e := listSSHLogin(c)
	require.NoError(t, e)
	require.Len(t, rows, 120)
	require.LessOrEqual(t, queries, 2)
	for _, row := range rows {
		require.Equal(t, []uint16{22}, row.Policy.Ports)
		require.Empty(t, row.Status.Banned)
	}
	tok.SetServerIDs([]uint64{2})
	c, _ = patRequestCtx(t, tok, 1, "GET", "/ssh-login?summary=1", nil)
	rows, e = listSSHLogin(c)
	require.NoError(t, e)
	require.Len(t, rows, 1)
	require.EqualValues(t, 2, rows[0].ID)
	require.Equal(t, "fail2ban", rows[0].Policy.Backend)
}
