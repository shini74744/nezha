package sshlogin

import (
	"encoding/binary"
	"fmt"
	"github.com/google/nftables"
	"github.com/google/nftables/expr"
	"golang.org/x/sys/unix"
	"net"
	"os"
	"strings"
	"testing"
	"time"
)

func isolatedKernelTest(t *testing.T) {
	t.Helper()
	parent := os.Getenv("DDNZ_NATIVE_PROBE_PARENT_NS")
	if parent == "" {
		t.Skip("requires a separate network namespace")
	}
	current, e := os.Readlink("/proc/self/ns/net")
	if e != nil || current == parent || !strings.HasPrefix(parent, "net:[") {
		t.Fatal("refusing firewall test outside an isolated namespace")
	}
	fd, e := unix.Socket(unix.AF_INET, unix.SOCK_DGRAM, 0)
	if e != nil {
		t.Fatal(e)
	}
	defer unix.Close(fd)
	ifr, e := unix.NewIfreq("lo")
	if e != nil {
		t.Fatal(e)
	}
	if e = unix.IoctlIfreq(fd, unix.SIOCGIFFLAGS, ifr); e != nil {
		t.Fatal(e)
	}
	ifr.SetUint16(ifr.Uint16() | unix.IFF_UP)
	if e = unix.IoctlIfreq(fd, unix.SIOCSIFFLAGS, ifr); e != nil {
		t.Fatal(e)
	}
	t.Logf("isolated netns %s, host %s", current, parent)
}
func tcpFixture(t *testing.T, network, addr string) (string, uint16) {
	t.Helper()
	l, e := net.Listen(network, addr)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { l.Close() })
	go func() {
		for {
			c, e := l.Accept()
			if e != nil {
				return
			}
			c.Close()
		}
	}()
	return l.Addr().String(), uint16(l.Addr().(*net.TCPAddr).Port)
}
func expectTCP(t *testing.T, network, addr string, ok bool) {
	t.Helper()
	c, e := net.DialTimeout(network, addr, 250*time.Millisecond)
	if c != nil {
		c.Close()
	}
	if (e == nil) != ok {
		t.Fatalf("connect %s expected success=%v, got %v", addr, ok, e)
	}
}
func tcpPortMatch(port uint16) []expr.Any {
	b := make([]byte, 2)
	binary.BigEndian.PutUint16(b, port)
	return []expr.Any{
		&expr.Meta{Key: expr.MetaKeyL4PROTO, Register: 1},
		&expr.Cmp{Op: expr.CmpOpEq, Register: 1, Data: []byte{unix.IPPROTO_TCP}},
		&expr.Payload{DestRegister: 1, Base: expr.PayloadBaseTransportHeader, Offset: 2, Len: 2},
		&expr.Cmp{Op: expr.CmpOpEq, Register: 1, Data: b},
	}
}
func TestSSHKernelNativePortFamilyAndExpiry(t *testing.T) {
	isolatedKernelTest(t)
	c := &nftables.Conn{}
	keep := c.AddTable(&nftables.Table{Name: "unrelated_fixture", Family: nftables.TableFamilyINet})
	table := c.AddTable(&nftables.Table{Name: "ddnz_native_probe", Family: nftables.TableFamilyINet})
	priority := nftables.ChainPriority(-10)
	policy := nftables.ChainPolicyAccept
	chain := c.AddChain(&nftables.Chain{Name: "input", Table: table, Type: nftables.ChainTypeFilter, Hooknum: nftables.ChainHookInput, Priority: &priority, Policy: &policy})
	if e := c.Flush(); e != nil {
		t.Fatal(e)
	}
	defer func() { c.DelTable(table); c.DelTable(keep); _ = c.Flush() }()
	a4, p4 := tcpFixture(t, "tcp4", "127.0.0.1:0")
	other, _ := tcpFixture(t, "tcp4", "127.0.0.1:0")
	a6, p6 := tcpFixture(t, "tcp6", "[::1]:0")
	expectTCP(t, "tcp4", a4, true)
	expectTCP(t, "tcp6", a6, true)
	for _, p := range []uint16{p4, p6} {
		match := tcpPortMatch(p)
		match = append(match, &expr.Counter{}, &expr.Verdict{Kind: expr.VerdictDrop})
		c.AddRule(&nftables.Rule{Table: table, Chain: chain, Exprs: match})
	}
	if e := c.Flush(); e != nil {
		t.Fatal(e)
	}
	expectTCP(t, "tcp4", a4, false)
	expectTCP(t, "tcp6", a6, false)
	expectTCP(t, "tcp4", other, true)
	// UDP on the same numeric port must remain unaffected.
	u, e := net.ListenPacket("udp4", fmt.Sprintf("127.0.0.1:%d", p4))
	if e != nil {
		t.Fatal(e)
	}
	defer u.Close()
	sender, e := net.Dial("udp4", u.LocalAddr().String())
	if e != nil {
		t.Fatal(e)
	}
	defer sender.Close()
	sender.Write([]byte("fixture"))
	u.SetReadDeadline(time.Now().Add(time.Second))
	b := make([]byte, 20)
	if _, _, e = u.ReadFrom(b); e != nil {
		t.Fatalf("blocked unrelated UDP: %v", e)
	}
	c.FlushChain(chain)
	if e = c.Flush(); e != nil {
		t.Fatal(e)
	}
	// Whitelist before a broad deny wins without granting other ports globally.
	permit := append(tcpPortMatch(p4), &expr.Verdict{Kind: expr.VerdictReturn})
	c.AddRule(&nftables.Rule{Table: table, Chain: chain, Exprs: permit})
	c.AddRule(&nftables.Rule{Table: table, Chain: chain, Exprs: append(tcpPortMatch(p4), &expr.Verdict{Kind: expr.VerdictDrop})})
	if e = c.Flush(); e != nil {
		t.Fatal(e)
	}
	expectTCP(t, "tcp4", a4, true)
	c.FlushChain(chain)
	timed := &nftables.Set{Table: table, Name: "ban4", KeyType: nftables.TypeIPAddr, HasTimeout: true}
	if e = c.AddSet(timed, []nftables.SetElement{{Key: net.ParseIP("127.0.0.1").To4(), Timeout: time.Second}}); e != nil {
		t.Fatal(e)
	}
	match := tcpPortMatch(p4)
	match = append(match, &expr.Meta{Key: expr.MetaKeyNFPROTO, Register: 1}, &expr.Cmp{Op: expr.CmpOpEq, Register: 1, Data: []byte{unix.NFPROTO_IPV4}}, &expr.Payload{DestRegister: 1, Base: expr.PayloadBaseNetworkHeader, Offset: 12, Len: 4}, &expr.Lookup{SourceRegister: 1, SetName: timed.Name, SetID: timed.ID}, &expr.Verdict{Kind: expr.VerdictDrop})
	c.AddRule(&nftables.Rule{Table: table, Chain: chain, Exprs: match})
	if e = c.Flush(); e != nil {
		t.Fatal(e)
	}
	elements, e := c.GetSetElements(timed)
	if e != nil || len(elements) != 1 {
		t.Fatalf("could not read native ban state: %v %+v", e, elements)
	}
	expectTCP(t, "tcp4", a4, false)
	time.Sleep(1100 * time.Millisecond)
	expectTCP(t, "tcp4", a4, true)
	c.DelTable(table)
	if e = c.Flush(); e != nil {
		t.Fatal(e)
	}
	if _, e = c.ListTableOfFamily(keep.Name, keep.Family); e != nil {
		t.Fatal("unrelated rules lost")
	}
	t.Log("PASS: native IPv4/IPv6 drop, TCP-port isolation, UDP preserved, whitelist ordering, kernel timeout, local state read and unrelated table preserved")
}
