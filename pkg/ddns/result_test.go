package ddns

import (
	"context"
	"fmt"
	"github.com/libdns/libdns"
	"github.com/miekg/dns"
	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"net"
	"testing"
)

type resultSetter struct {
	calls int
	fail  int
}

func (s *resultSetter) SetRecords(_ context.Context, _ string, r []libdns.Record) ([]libdns.Record, error) {
	s.calls++
	if s.calls <= s.fail {
		return nil, fmt.Errorf("provider refused token=DO_NOT_FORWARD")
	}
	return r, nil
}
func resultDNSContext(t *testing.T, soa bool) context.Context {
	t.Helper()
	pc, err := net.ListenPacket("udp", "127.0.0.1:0")
	require.NoError(t, err)
	server := &dns.Server{PacketConn: pc, Net: "udp", Handler: dns.HandlerFunc(func(w dns.ResponseWriter, r *dns.Msg) {
		m := new(dns.Msg)
		m.SetReply(r)
		if soa {
			m.Answer = []dns.RR{&dns.SOA{Hdr: dns.RR_Header{Name: "example.com.", Rrtype: dns.TypeSOA, Class: dns.ClassINET, Ttl: 300}, Ns: "ns.example.com.", Mbox: "admin.example.com.", Serial: 1}}
		}
		_ = w.WriteMsg(m)
	})}
	go server.ActivateAndServe()
	t.Cleanup(func() { server.Shutdown(); pc.Close() })
	return context.WithValue(context.Background(), DNSServerKey{}, []string{pc.LocalAddr().String()})
}
func TestUpdateResultsAreFinalAndSecretSafe(t *testing.T) {
	yes := true
	for _, tc := range []struct {
		name     string
		fail     int
		success  bool
		attempts int
	}{
		{"immediate", 0, true, 1}, {"retry_success", 1, true, 2}, {"exhausted", 10, false, 3},
	} {
		t.Run(tc.name, func(t *testing.T) {
			setter := &resultSetter{fail: tc.fail}
			p := Provider{DDNSProfile: &model.DDNSProfile{EnableIPv4: &yes, MaxRetries: 3, Domains: []string{"host.example.com"}},
				IPAddrs: &model.IP{IPv4Addr: "192.0.2.10"}, Setter: setter}
			result := p.UpdateDomain(resultDNSContext(t, true))
			require.Len(t, result, 1)
			require.Equal(t, tc.success, result[0].Success)
			require.Equal(t, tc.attempts, result[0].Attempts)
			require.Equal(t, tc.attempts, setter.calls)
			require.NotContains(t, result[0].Detail, "DO_NOT_FORWARD")
		})
	}
}
func TestUpdateResultsDeletionUnsupportedAndSOAFailure(t *testing.T) {
	yes := true
	p := Provider{DDNSProfile: &model.DDNSProfile{EnableIPv4: &yes, EnableIPv6: &yes, MaxRetries: 2, Domains: []string{"host.example.com"}},
		IPAddrs: &model.IP{}, Setter: &MockUnsupportedSetter{}}
	results := p.UpdateDomain(resultDNSContext(t, true))
	require.Len(t, results, 2)
	for _, r := range results {
		require.False(t, r.Success)
		require.Equal(t, "删除", r.Action)
		require.Contains(t, r.Detail, "不支持")
		require.Zero(t, r.Attempts)
	}
	p.Setter = &MockSetter{}
	results = p.UpdateDomain(resultDNSContext(t, true))
	for _, r := range results {
		require.True(t, r.Success)
		require.Equal(t, "删除", r.Action)
	}
	results = p.UpdateDomain(resultDNSContext(t, false))
	for _, r := range results {
		require.False(t, r.Success)
		require.Contains(t, r.Detail, "SOA")
	}
}
func TestUpdateResultsDualStackAndOverride(t *testing.T) {
	yes := true
	p := Provider{DDNSProfile: &model.DDNSProfile{EnableIPv4: &yes, EnableIPv6: &yes, MaxRetries: 1, Domains: []string{"unused.example.com"}},
		IPAddrs: &model.IP{IPv4Addr: "192.0.2.10", IPv6Addr: "2001:db8::10"}, Setter: &MockSetter{}}
	results := p.UpdateDomain(resultDNSContext(t, true), "override.example.com")
	require.Len(t, results, 2)
	require.Equal(t, "A", results[0].RecordType)
	require.Equal(t, "AAAA", results[1].RecordType)
	for _, r := range results {
		require.Equal(t, "override.example.com", r.Domain)
		require.True(t, r.Success)
	}
}
