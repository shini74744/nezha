package singleton

import (
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/ddns"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestDDNSEventContentAndMaskedTarget(t *testing.T) {
	old := Conf
	Conf = &ConfigClass{Config: &model.Config{}}
	defer func() { Conf = old }()
	s := &model.Server{Common: model.Common{ID: 12}, Name: "fixture"}
	p := &model.DDNSProfile{Name: "profile"}
	r := ddns.UpdateResult{Domain: "example.com", RecordType: "A", IP: "192.0.2.10", Success: true, Detail: "更新请求执行成功"}
	msg, e := ddnsNotificationEvent(s, p, r)
	require.Equal(t, "ddns_success", e.Kind)
	require.Equal(t, "example.com", e.Domain)
	require.NotContains(t, msg, "192.0.2.10")
	require.Equal(t, IPDesensitize(r.IP), e.TargetIP)
	r.Success = false
	r.Detail = "更新失败"
	_, e = ddnsNotificationEvent(s, p, r)
	require.Equal(t, "ddns_failure", e.Kind)
	r.IP = ""
	_, e = ddnsNotificationEvent(s, p, r)
	require.Contains(t, e.TargetIP, "删除记录")
	require.True(t, DDNSNotificationGroupAllowed(10, 10))
	require.False(t, DDNSNotificationGroupAllowed(0, 10))
}
