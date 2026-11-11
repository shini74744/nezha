package sshlogin

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/google/nftables"
	"github.com/mdlayher/netlink"
	"golang.org/x/sys/unix"
)

func addLoopbackAddress(t *testing.T, raw string) {
	t.Helper()
	address := net.ParseIP(raw)
	family, bits := byte(unix.AF_INET6), byte(128)
	if address.To4() != nil {
		address = address.To4()
		family = unix.AF_INET
		bits = 32
	} else {
		address = address.To16()
	}
	iface, e := net.InterfaceByName("lo")
	if e != nil {
		t.Fatal(e)
	}
	c, e := netlink.Dial(unix.NETLINK_ROUTE, nil)
	if e != nil {
		t.Fatal(e)
	}
	defer c.Close()
	attrs, e := netlink.MarshalAttributes([]netlink.Attribute{{Type: unix.IFA_LOCAL, Data: address}, {Type: unix.IFA_ADDRESS, Data: address}})
	if e != nil {
		t.Fatal(e)
	}
	data := make([]byte, 8)
	data[0] = family
	data[1] = bits
	data[2] = unix.IFA_F_NODAD
	binary.NativeEndian.PutUint32(data[4:], uint32(iface.Index))
	_, e = c.Execute(netlink.Message{Header: netlink.Header{Type: unix.RTM_NEWADDR, Flags: netlink.Request | netlink.Acknowledge | netlink.Create | netlink.Excl}, Data: append(data, attrs...)})
	if e != nil && !errors.Is(e, unix.EEXIST) {
		t.Fatal(e)
	}
}
func expectFrom(t *testing.T, network, target, source string, ok bool) {
	t.Helper()
	d := net.Dialer{Timeout: 250 * time.Millisecond, LocalAddr: &net.TCPAddr{IP: net.ParseIP(source)}}
	c, e := d.Dial(network, target)
	if c != nil {
		c.Close()
	}
	if (e == nil) != ok {
		t.Fatalf("%s -> %s wanted success=%v, got %v", source, target, ok, e)
	}
}
func hashPrefixes(p *Policy, prefixes []string) {
	p.BlockHash = fmt.Sprintf("%x", sha256.Sum256([]byte(strings.Join(prefixes, "\n"))))
}
func TestSSHKernelCompleteNativePolicy(t *testing.T) {
	isolatedKernelTest(t)
	for _, a := range []string{"192.0.2.10", "192.0.2.11", "2001:db8::10", "2001:db8::11"} {
		addLoopbackAddress(t, a)
	}
	a4, p4 := tcpFixture(t, "tcp4", "192.0.2.10:0")
	other, _ := tcpFixture(t, "tcp4", "192.0.2.10:0")
	a6, p6 := tcpFixture(t, "tcp6", "[2001:db8::10]:0")
	c := &nftables.Conn{}
	keep := c.AddTable(&nftables.Table{Name: "existing_business", Family: nftables.TableFamilyINet})
	if e := c.Flush(); e != nil {
		t.Fatal(e)
	}
	defer func() { c.DelTable(keep); _ = c.Flush() }()
	g := blacklistGuard{Name: "ddnz_ssh_0123456789abcdef"}
	p := initialPolicy()
	p.Enabled = true
	p.AutoBan = true
	p.Ports = []uint16{p4, p6}
	p.Allowlist = []string{"192.0.2.11", "2001:db8::11"}
	prefixes := []string{"0.0.0.0/0", "2001:db8::/32", "2001:db8::10/128"}
	hashPrefixes(&p, prefixes)
	if e := g.apply(context.Background(), p, prefixes, nil); e != nil {
		t.Fatal(e)
	}
	expectFrom(t, "tcp4", a4, "192.0.2.10", false)
	expectFrom(t, "tcp4", a4, "192.0.2.11", true)
	expectFrom(t, "tcp6", a6, "2001:db8::10", false)
	expectFrom(t, "tcp6", a6, "2001:db8::11", true)
	expectFrom(t, "tcp4", other, "192.0.2.10", true)
	// Only-whitelist mode covers both address families and only selected ports.
	prefixes = nil
	hashPrefixes(&p, prefixes)
	p.WhitelistOnly = true
	if e := g.apply(context.Background(), p, prefixes, nil); e != nil {
		t.Fatal(e)
	}
	expectFrom(t, "tcp4", a4, "192.0.2.10", false)
	expectFrom(t, "tcp4", a4, "192.0.2.11", true)
	expectFrom(t, "tcp6", a6, "2001:db8::10", false)
	expectFrom(t, "tcp6", a6, "2001:db8::11", true)
	expectFrom(t, "tcp4", other, "192.0.2.10", true)
	// A new Agent instance restores remaining time, not a fresh ban duration.
	p.WhitelistOnly = false
	bans := map[string]int64{"192.0.2.10": time.Now().Add(1500 * time.Millisecond).UnixMilli(), "2001:db8::10": -1}
	if e := g.apply(context.Background(), p, nil, bans); e != nil {
		t.Fatal(e)
	}
	restored := blacklistGuard{Name: g.Name}
	if e := restored.apply(context.Background(), p, nil, bans); e != nil {
		t.Fatal(e)
	}
	actual, e := restored.banned()
	if e != nil || len(actual) != 2 {
		t.Fatalf("local ban read failed: %+v %v", actual, e)
	}
	expectFrom(t, "tcp4", a4, "192.0.2.10", false)
	expectFrom(t, "tcp6", a6, "2001:db8::10", false)
	time.Sleep(1600 * time.Millisecond)
	expectFrom(t, "tcp4", a4, "192.0.2.10", true)
	expectFrom(t, "tcp6", a6, "2001:db8::10", false)
	delete(bans, "2001:db8::10")
	if e := restored.apply(context.Background(), p, nil, bans); e != nil {
		t.Fatal(e)
	}
	expectFrom(t, "tcp6", a6, "2001:db8::10", true)
	p.Enabled = false
	if e := restored.apply(context.Background(), p, nil, nil); e != nil {
		t.Fatal(e)
	}
	if _, e := c.ListTableOfFamily(keep.Name, keep.Family); e != nil {
		t.Fatal("business table removed")
	}
	expectFrom(t, "tcp4", a4, "192.0.2.10", true)
	t.Log("PASS: actual native backend CIDR overlap/full-range, whitelist IPv4/IPv6, selected ports, restart, ban expiry, permanent ban, manual unban and disable")
}
func TestSSHNativeCounterWindowAllowlistAndPersistence(t *testing.T) {
	p := initialPolicy()
	p.Enabled = true
	p.AutoBan = true
	p.Ports = []uint16{2222}
	p.MaxRetry = 3
	p.Allowlist = []string{"192.0.2.0/24"}
	now := time.Now()
	state := nativeState{}
	for i := 0; i < 3; i++ {
		if e := state.observe(p, Event{SourceIP: "198.51.100.1", Port: 2222, Time: now.UnixMilli()}, now); e != nil {
			t.Fatal(e)
		}
	}
	if state.Bans["198.51.100.1"] != now.Add(time.Hour).UnixMilli() {
		t.Fatal("wrong threshold or expiry")
	}
	for _, ip := range []string{"192.0.2.1", "::ffff:192.0.2.1", "127.0.0.1"} {
		for i := 0; i < 4; i++ {
			state.observe(p, Event{SourceIP: ip, Port: 2222, Time: now.UnixMilli()}, now)
		}
	}
	if len(state.Bans) != 1 {
		t.Fatal("whitelist banned")
	}
	state.observe(p, Event{SourceIP: "203.0.113.1", Port: 22, Time: now.UnixMilli()}, now)
	state.observe(p, Event{SourceIP: "203.0.113.1", Port: 0, Time: now.UnixMilli()}, now)
	state.observe(p, Event{SourceIP: "203.0.113.1", Port: 2222, Time: now.Add(-time.Hour).UnixMilli()}, now)
	if len(state.Failures) != 0 {
		t.Fatal("wrong port or old log counted")
	}
	if e := state.unban("198.51.100.1"); e != nil || len(state.Bans) != 0 {
		t.Fatal("unban failed")
	}
}

func TestSSHKernelInstanceConflictAndAtomicRollback(t *testing.T) {
	isolatedKernelTest(t)
	target, port := tcpFixture(t, "tcp4", "127.0.0.1:0")
	_, other := tcpFixture(t, "tcp4", "127.0.0.1:0")
	p := initialPolicy()
	p.Enabled = true
	p.AutoBan = true
	p.Ports = []uint16{port}
	first := blacklistGuard{Name: "ddnz_ssh_aaaaaaaaaaaaaaaa"}
	second := blacklistGuard{Name: "ddnz_ssh_bbbbbbbbbbbbbbbb"}
	if e := first.apply(context.Background(), p, nil, nil); e != nil {
		t.Fatal(e)
	}
	if e := second.apply(context.Background(), p, nil, nil); e == nil {
		t.Fatal("overlapping Agent instance accepted")
	}
	p.Ports = []uint16{other}
	if e := second.apply(context.Background(), p, nil, nil); e != nil {
		t.Fatal("independent ports rejected", e)
	}
	p.Ports = []uint16{port}
	p.Allowlist = []string{"not-an-ip"}
	if e := first.apply(context.Background(), p, nil, nil); e == nil {
		t.Fatal("invalid replacement accepted")
	}
	expectFrom(t, "tcp4", target, "127.0.0.1", true)
	p.Allowlist = nil
	p.Enabled = false
	if e := first.apply(context.Background(), p, nil, nil); e != nil {
		t.Fatal(e)
	}
	if e := second.apply(context.Background(), p, nil, nil); e != nil {
		t.Fatal(e)
	}
}
