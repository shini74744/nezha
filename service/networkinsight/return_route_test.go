package networkinsight

import (
	"context"
	"github.com/stretchr/testify/require"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestReturnPolicyTargetsAndCommandSafety(t *testing.T) {
	p := DefaultReturnPolicy()
	require.NoError(t, p.Validate())
	require.False(t, p.Enabled)
	require.Len(t, p.Targets, 9)
	for _, ip := range []string{"127.0.0.1", "10.1.1.1", "0.1.2.3", "169.254.169.254", "100.64.0.1", "192.0.0.1", "198.18.0.1", "224.0.0.1", "240.1.1.1", "1.1.1.1;id", "1.1.1.1\nwhoami", "localhost", "::ffff:1.1.1.1", "fe80::1%eth0", "2002:7f00:1::", "64:ff9b::7f00:1"} {
		p = DefaultReturnPolicy()
		p.Targets[0].IPv4 = ip
		require.Error(t, p.Validate(), ip)
		_, e := ReturnCommand(ip, "IPv4", "tcp")
		require.Error(t, e, ip)
	}
	p = DefaultReturnPolicy()
	p.Targets[1].ID = p.Targets[0].ID
	require.Error(t, p.Validate())
	p = DefaultReturnPolicy()
	p.Protocol = "tcp;id"
	require.Error(t, p.Validate())
	p = DefaultReturnPolicy()
	p.Targets = nil
	require.Error(t, p.Validate())
	for _, protocol := range []string{"tcp", "udp", "icmp"} {
		cmd, e := ReturnCommand("1.1.1.1", "IPv4", protocol)
		require.NoError(t, e)
		require.Contains(t, cmd, "sha256sum -c")
		require.Contains(t, cmd, "v1.7.3")
		require.Contains(t, cmd, "-j -M -n")
		require.Contains(t, cmd, "timeout -s TERM -k 2 35")
		require.NotContains(t, cmd, "curl -k")
		require.NotContains(t, cmd, "Net.Check")
		require.NotContains(t, cmd, "speedtest")
		if runtime.GOOS != "windows" {
			raw, e := exec.Command("sh", "-n", "-c", cmd).CombinedOutput()
			require.NoError(t, e, string(raw))
		}
	}
	require.Len(t, EmptyReturnRoutes(DefaultReturnPolicy(), []string{"IPv4"}), 9)
	require.Len(t, EmptyReturnRoutes(DefaultReturnPolicy(), []string{"IPv4", "IPv6"}), 18)
}
func TestReturnParseAverageMultipathAndStatuses(t *testing.T) {
	base := ReturnResult{ID: "a", Name: "上海", Family: "IPv4", Protocol: "tcp", Target: "1.1.1.1"}
	body := `NZR|0
{"Hops":[[{"Success":true,"Address":{"IP":"59.43.1.1"},"TTL":1,"RTT":10000000,"Geo":{"asnumber":"4809","country":"中国","owner":"CT"}},{"Success":true,"Address":{"IP":"59.43.1.1"},"TTL":1,"RTT":20000000},{"Success":true,"Address":{"IP":"8.8.8.8"},"TTL":1,"RTT":30000000,"Geo":{"asnumber":"15169"}}],[{"Success":false,"TTL":2}],[{"Success":true,"Address":{"IP":"1.1.1.1"},"TTL":3,"RTT":45000000,"Geo":{"asnumber":"13335"}}]]}`
	result := ParseReturnResult(base, body, true)
	require.Equal(t, "reached", result.Status)
	require.Len(t, result.Hops, 4)
	require.Equal(t, 15.0, *result.Hops[0].RTT)
	require.Equal(t, 2, result.Hops[0].Samples)
	require.Nil(t, result.Hops[2].RTT)
	require.Equal(t, []string{"电信 CN2", "AS15169", "AS13335"}, result.Route)
	for _, status := range []string{"unsupported", "tool_missing", "permission", "download_failed", "integrity_failed"} {
		require.Equal(t, status, ParseReturnResult(base, "NZR|"+status+"\n", true).Status)
	}
	require.Equal(t, "timeout", ParseReturnResult(base, "NZR|124\n", true).Status)
	require.Equal(t, "disabled", ParseReturnResult(base, "此 Agent 已禁止命令执行", false).Status)
	require.Equal(t, "invalid_result", ParseReturnResult(base, strings.Repeat("x", ReturnOutputLimit+1), true).Status)
	require.Equal(t, "invalid_result", ParseReturnResult(base, "NZR|0\n{}", true).Status)
	require.Equal(t, "no_reply", ParseReturnResult(base, `NZR|0
{"Hops":[[{"Success":false,"TTL":1}]]}`, true).Status)
	require.Equal(t, "partial", ParseReturnResult(base, strings.ReplaceAll(body, "1.1.1.1", "1.0.0.1"), true).Status)
}
func TestReturnRouteLiveNextTrace(t *testing.T) {
	if os.Getenv("NEZHA_RETURN_ROUTE_LIVE") != "1" {
		t.Skip("explicit on-node network check")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 75*time.Second)
	defer cancel()
	target := DefaultReturnPolicy().Targets[3]
	cmd, err := ReturnCommand(target.IPv4, "IPv4", "tcp")
	require.NoError(t, err)
	raw, err := exec.CommandContext(ctx, "sh", "-c", cmd).Output()
	require.NoError(t, err)
	got := ParseReturnResult(ReturnResult{ID: target.ID, Target: target.IPv4, Family: "IPv4", Protocol: "tcp"}, string(raw), true)
	require.Contains(t, []string{"reached", "partial", "no_reply"}, got.Status)
	require.NotEmpty(t, got.Hops)
	t.Logf("NextTrace status=%s hops=%d route=%v", got.Status, len(got.Hops), got.Route)
}
