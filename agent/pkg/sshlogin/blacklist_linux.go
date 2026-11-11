package sshlogin

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/netip"
	"slices"
	"strings"
	"time"

	"github.com/google/nftables"
	"github.com/google/nftables/expr"
	"github.com/mdlayher/netlink"
	"golang.org/x/sys/unix"
)

func verifyPrefixes(prefixes []string, hash string) error {
	if len(prefixes) > 2000000 || len(strings.Join(prefixes, "\n")) > 48<<20 {
		return fmt.Errorf("黑名单过大")
	}
	for _, raw := range prefixes {
		p, e := netip.ParsePrefix(raw)
		if e != nil || p.Masked().String() != raw {
			return fmt.Errorf("黑名单网段无效")
		}
	}
	sum := sha256.Sum256([]byte(strings.Join(prefixes, "\n")))
	if hex.EncodeToString(sum[:]) != hash {
		return fmt.Errorf("黑名单校验失败")
	}
	return nil
}

type addressRange struct{ start, end netip.Addr }

func rangesFor(prefixes []string, ipv4 bool) ([]addressRange, error) {
	ranges := []addressRange{}
	for _, raw := range prefixes {
		p, e := netip.ParsePrefix(raw)
		if e != nil {
			a, e := netip.ParseAddr(raw)
			if e != nil || a.Zone() != "" {
				return nil, fmt.Errorf("无效网段")
			}
			a = a.Unmap()
			p = netip.PrefixFrom(a, a.BitLen())
		}
		p = p.Masked()
		if p.Addr().Is4() != ipv4 {
			continue
		}
		first := p.Addr()
		last := append([]byte{}, first.AsSlice()...)
		for bit := p.Bits(); bit < len(last)*8; bit++ {
			last[bit/8] |= byte(1 << (7 - bit%8))
		}
		end, _ := netip.AddrFromSlice(last)
		ranges = append(ranges, addressRange{first, end})
	}
	slices.SortFunc(ranges, func(a, b addressRange) int {
		if c := a.start.Compare(b.start); c != 0 {
			return c
		}
		return a.end.Compare(b.end)
	})
	merged := []addressRange{}
	for _, r := range ranges {
		if len(merged) > 0 {
			last := &merged[len(merged)-1]
			next := last.end.Next()
			if r.start.Compare(last.end) <= 0 || (next.IsValid() && r.start.Compare(next) <= 0) {
				if r.end.Compare(last.end) > 0 {
					last.end = r.end
				}
				continue
			}
		}
		merged = append(merged, r)
	}
	return merged, nil
}
func intervalElements(ranges []addressRange) []nftables.SetElement {
	out := []nftables.SetElement{}
	for _, r := range ranges {
		out = append(out, nftables.SetElement{Key: r.start.AsSlice()})
		end := r.end.Next()
		var b []byte
		if end.IsValid() {
			b = end.AsSlice()
		} else {
			b = make([]byte, len(r.end.AsSlice()))
		}
		out = append(out, nftables.SetElement{Key: b, IntervalEnd: true})
	}
	return out
}
func newNftConn() (*nftables.Conn, error) {
	return nftables.New(nftables.WithSockOptions(func(c *netlink.Conn) error {
		raw, e := c.SyscallConn()
		if e != nil {
			return e
		}
		var sockErr error
		if e = raw.Control(func(fd uintptr) { sockErr = unix.SetsockoptInt(int(fd), unix.SOL_SOCKET, unix.SO_SNDBUFFORCE, 4<<20) }); e != nil {
			return e
		}
		if sockErr != nil {
			_ = c.SetWriteBuffer(1 << 20)
		}
		return c.SetDeadline(time.Now().Add(8 * time.Second))
	}))
}
func addElements(c *nftables.Conn, set *nftables.Set, elements []nftables.SetElement, staging bool) error {
	for len(elements) > 0 {
		n := min(len(elements), 512)
		if e := c.SetAddElements(set, elements[:n]); e != nil {
			return e
		}
		if staging {
			if e := c.Flush(); e != nil {
				return e
			}
		}
		elements = elements[n:]
	}
	return nil
}

type blacklistGuard struct {
	Name, Hash      string
	Revision        uint64
	Ready, HadRules bool
	fingerprint     string
}

func (g *blacklistGuard) owned(c *nftables.Conn, t *nftables.Table) error {
	chain, e := c.ListChain(t, "ddnz_owner")
	if e != nil {
		return fmt.Errorf("存在同名防火墙规则，原规则已保留")
	}
	rules, e := c.GetRules(t, chain)
	if e != nil || len(rules) != 1 || !bytes.Equal(rules[0].UserData, []byte("DDnezha SSH "+g.Name)) {
		return fmt.Errorf("无法确认防火墙规则归属")
	}
	return nil
}
func (g *blacklistGuard) apply(ctx context.Context, p Policy, prefixes []string, bans map[string]int64) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if len(g.Name) != len("ddnz_ssh_")+16 || !strings.HasPrefix(g.Name, "ddnz_ssh_") || strings.Trim(strings.TrimPrefix(g.Name, "ddnz_ssh_"), "0123456789abcdef") != "" {
		return fmt.Errorf("invalid firewall table")
	}
	if e := p.Validate(); e != nil {
		return e
	}
	if p.BlockHash != "" {
		if e := verifyPrefixes(prefixes, p.BlockHash); e != nil {
			return e
		}
	} else if len(prefixes) > 0 {
		return fmt.Errorf("黑名单校验失败")
	}
	wanted := p.Enabled && (len(prefixes) > 0 || p.AutoBan || p.WhitelistOnly || len(bans) > 0)
	if !wanted && !g.HadRules {
		g.Ready = true
		g.Hash = p.BlockHash
		g.Revision = p.Revision
		return nil
	}
	c, e := newNftConn()
	if e != nil {
		return e
	}
	tables, e := c.ListTablesOfFamily(nftables.TableFamilyINet)
	if e != nil {
		return fmt.Errorf("原生防护不可用：请检查内核防火墙支持和权限")
	}
	var table *nftables.Table
	for _, t := range tables {
		if g.isOwnName(t.Name) {
			if e = g.owned(c, t); e != nil {
				return e
			}
			if t.Name == g.Name || g.isActive(c, t) {
				if table != nil {
					return fmt.Errorf("本机存在重复的 SSH 防护规则，请检查后重试")
				}
				table = t
			} else {
				c.DelTable(t)
				if e = c.Flush(); e != nil {
					return e
				}
			}
			continue
		}
		if wanted && strings.HasPrefix(t.Name, "ddnz_ssh_") && g.isActive(c, t) {
			set, err := c.GetSetByName(t, "ports")
			if err != nil {
				return fmt.Errorf("另一实例的 SSH 端口暂时无法确认")
			}
			elements, err := c.GetSetElements(set)
			if err != nil {
				return err
			}
			for _, v := range elements {
				if len(v.Key) == 2 && slices.Contains(p.Ports, binary.BigEndian.Uint16(v.Key)) {
					return fmt.Errorf("所选 SSH 端口已由另一 Agent 实例保护，原规则已保留")
				}
			}
		}
	}
	signature, _ := json.Marshal(struct {
		Enabled, Auto, WhitelistOnly bool
		Ports                        []uint16
		Allow                        []string
		Hash                         string
	}{p.Enabled, p.AutoBan, p.WhitelistOnly, p.Ports, p.Allowlist, p.BlockHash})
	sum := sha256.Sum256(signature)
	fingerprint := hex.EncodeToString(sum[:])
	if table != nil && g.Ready && g.fingerprint == fingerprint && wanted {
		return g.syncBans(c, table, bans)
	}
	if !wanted {
		if table != nil {
			c.DelTable(table)
		}
		if table != nil {
			if e = c.Flush(); e != nil {
				return e
			}
		}
		g.Ready = true
		g.HadRules = false
		g.Hash = p.BlockHash
		g.Revision = p.Revision
		g.fingerprint = fingerprint
		return nil
	}
	oldTable := table
	stageName := g.Name + "_a"
	if oldTable != nil && oldTable.Name == stageName {
		stageName = g.Name + "_b"
	}
	table = c.AddTable(&nftables.Table{Name: stageName, Family: nftables.TableFamilyINet})
	committed := false
	defer func() {
		if !committed {
			g.cleanupStage(stageName)
		}
	}()
	owner := c.AddChain(&nftables.Chain{Name: "ddnz_owner", Table: table})
	c.AddRule(&nftables.Rule{Table: table, Chain: owner, Exprs: []expr.Any{&expr.Counter{}}, UserData: []byte("DDnezha SSH " + g.Name)})
	priority := nftables.ChainPriority(-10)
	policy := nftables.ChainPolicyAccept
	chain := c.AddChain(&nftables.Chain{Name: "input", Table: table})
	ports := &nftables.Set{Name: "ports", Table: table, KeyType: nftables.TypeInetService}
	portElements := []nftables.SetElement{}
	for _, port := range p.Ports {
		b := make([]byte, 2)
		binary.BigEndian.PutUint16(b, port)
		portElements = append(portElements, nftables.SetElement{Key: b})
	}
	if e = c.AddSet(ports, portElements); e != nil {
		return e
	}
	sets := map[string]*nftables.Set{}
	for _, definition := range []struct {
		name   string
		v4     bool
		values []string
	}{
		{"allow4", true, append([]string{"127.0.0.0/8", "::1"}, p.Allowlist...)},
		{"allow6", false, append([]string{"127.0.0.0/8", "::1"}, p.Allowlist...)},
		{"deny4", true, prefixes}, {"deny6", false, prefixes},
	} {
		kind := nftables.TypeIPAddr
		if !definition.v4 {
			kind = nftables.TypeIP6Addr
		}
		set := &nftables.Set{Name: definition.name, Table: table, KeyType: kind, Interval: true}
		ranges, e := rangesFor(definition.values, definition.v4)
		if e != nil {
			return e
		}
		if e = c.AddSet(set, nil); e != nil {
			return e
		}
		if e = addElements(c, set, intervalElements(ranges), true); e != nil {
			return e
		}
		sets[set.Name] = set
	}
	for _, v := range []struct {
		name string
		kind nftables.SetDatatype
	}{{"ban4", nftables.TypeIPAddr}, {"ban6", nftables.TypeIP6Addr}} {
		set := &nftables.Set{Name: v.name, Table: table, KeyType: v.kind, HasTimeout: true}
		if e = c.AddSet(set, nil); e != nil {
			return e
		}
		sets[set.Name] = set
	}
	for _, name := range []string{"allow4", "allow6", "deny4", "deny6", "ban4", "ban6"} {
		v4 := strings.HasSuffix(name, "4")
		family, offset, length := byte(unix.NFPROTO_IPV6), uint32(8), uint32(16)
		if v4 {
			family, offset, length = unix.NFPROTO_IPV4, 12, 4
		}
		action := expr.VerdictDrop
		if strings.HasPrefix(name, "allow") {
			action = expr.VerdictReturn
		}
		expressions := []expr.Any{
			&expr.Meta{Key: expr.MetaKeyL4PROTO, Register: 1}, &expr.Cmp{Op: expr.CmpOpEq, Register: 1, Data: []byte{unix.IPPROTO_TCP}},
			&expr.Payload{DestRegister: 1, Base: expr.PayloadBaseTransportHeader, Offset: 2, Len: 2}, &expr.Lookup{SourceRegister: 1, SetName: ports.Name, SetID: ports.ID},
			&expr.Meta{Key: expr.MetaKeyNFPROTO, Register: 1}, &expr.Cmp{Op: expr.CmpOpEq, Register: 1, Data: []byte{family}},
			&expr.Payload{DestRegister: 1, Base: expr.PayloadBaseNetworkHeader, Offset: offset, Len: length},
			&expr.Lookup{SourceRegister: 1, SetName: name, SetID: sets[name].ID}, &expr.Counter{}, &expr.Verdict{Kind: action},
		}
		c.AddRule(&nftables.Rule{Table: table, Chain: chain, Exprs: expressions})
	}
	if p.WhitelistOnly {
		c.AddRule(&nftables.Rule{Table: table, Chain: chain, Exprs: []expr.Any{
			&expr.Meta{Key: expr.MetaKeyL4PROTO, Register: 1}, &expr.Cmp{Op: expr.CmpOpEq, Register: 1, Data: []byte{unix.IPPROTO_TCP}},
			&expr.Payload{DestRegister: 1, Base: expr.PayloadBaseTransportHeader, Offset: 2, Len: 2}, &expr.Lookup{SourceRegister: 1, SetName: ports.Name, SetID: ports.ID},
			&expr.Counter{}, &expr.Verdict{Kind: expr.VerdictDrop},
		}})
	}
	if e = queueBans(c, sets["ban4"], sets["ban6"], bans, true); e != nil {
		return e
	}
	// No staged rule is reachable until this final atomic hook replacement.
	entry := c.AddChain(&nftables.Chain{Name: "entry", Table: table, Type: nftables.ChainTypeFilter, Hooknum: nftables.ChainHookInput, Priority: &priority, Policy: &policy})
	c.AddRule(&nftables.Rule{Table: table, Chain: entry, Exprs: []expr.Any{&expr.Verdict{Kind: expr.VerdictJump, Chain: chain.Name}}})
	if oldTable != nil {
		c.DelTable(oldTable)
	}
	if e = c.Flush(); e != nil {
		return fmt.Errorf("原生防护应用失败：%w", e)
	}
	committed = true
	g.Ready = true
	g.HadRules = true
	g.Hash = p.BlockHash
	g.Revision = p.Revision
	g.fingerprint = fingerprint
	return nil
}
func queueBans(c *nftables.Conn, s4, s6 *nftables.Set, bans map[string]int64, staging bool) error {
	now := time.Now()
	e4, e6 := []nftables.SetElement{}, []nftables.SetElement{}
	for raw, until := range bans {
		ip, e := netip.ParseAddr(raw)
		if e != nil || ip.Zone() != "" {
			return fmt.Errorf("封禁 IP 无效")
		}
		ip = ip.Unmap()
		item := nftables.SetElement{Key: ip.AsSlice()}
		if until > 0 {
			duration := time.UnixMilli(until).Sub(now)
			if duration <= 0 {
				continue
			}
			item.Timeout = duration
		}
		if ip.Is4() {
			e4 = append(e4, item)
		} else {
			e6 = append(e6, item)
		}
	}
	if e := addElements(c, s4, e4, staging); e != nil {
		return e
	}
	return addElements(c, s6, e6, staging)
}
func (g *blacklistGuard) syncBans(c *nftables.Conn, table *nftables.Table, bans map[string]int64) error {
	s4, e := c.GetSetByName(table, "ban4")
	if e != nil {
		return e
	}
	s6, e := c.GetSetByName(table, "ban6")
	if e != nil {
		return e
	}
	c.FlushSet(s4)
	c.FlushSet(s6)
	if e = queueBans(c, s4, s6, bans, false); e != nil {
		return e
	}
	return c.Flush()
}
func (g *blacklistGuard) banned() ([]string, error) {
	if !g.HadRules {
		return []string{}, nil
	}
	c, e := newNftConn()
	if e != nil {
		return nil, e
	}
	tables, e := c.ListTablesOfFamily(nftables.TableFamilyINet)
	if e != nil {
		return nil, e
	}
	var t *nftables.Table
	for _, candidate := range tables {
		if g.isOwnName(candidate.Name) && (candidate.Name == g.Name || g.isActive(c, candidate)) {
			t = candidate
			break
		}
	}
	if t == nil {
		return nil, fmt.Errorf("本机 SSH 规则不存在")
	}
	if e = g.owned(c, t); e != nil {
		return nil, e
	}
	out := []string{}
	for _, name := range []string{"ban4", "ban6"} {
		set, e := c.GetSetByName(t, name)
		if e != nil {
			return nil, e
		}
		items, e := c.GetSetElements(set)
		if e != nil {
			return nil, e
		}
		for _, item := range items {
			if ip, ok := netip.AddrFromSlice(item.Key); ok {
				out = append(out, ip.Unmap().String())
			}
		}
	}
	slices.Sort(out)
	return out, nil
}

func decodePrefixes(reply Reply, hash string) ([]string, error) {
	prefixes := reply.Prefixes
	if len(reply.PrefixesGzip) > 0 {
		if len(reply.PrefixesGzip) > 2<<20 {
			return nil, fmt.Errorf("compressed blacklist too large")
		}
		reader, e := gzip.NewReader(bytes.NewReader(reply.PrefixesGzip))
		if e != nil {
			return nil, e
		}
		defer reader.Close()
		body, e := io.ReadAll(io.LimitReader(reader, 48<<20+1))
		if e != nil || len(body) > 48<<20 {
			return nil, fmt.Errorf("invalid blacklist data")
		}
		prefixes = nil
		if len(body) > 0 {
			prefixes = strings.Split(string(body), "\n")
		}
	}
	if e := verifyPrefixes(prefixes, hash); e != nil {
		return nil, e
	}
	return prefixes, nil
}
func (g *blacklistGuard) isOwnName(name string) bool {
	return name == g.Name || name == g.Name+"_a" || name == g.Name+"_b"
}
func (g *blacklistGuard) isActive(c *nftables.Conn, t *nftables.Table) bool {
	for _, name := range []string{"entry", "input"} {
		if chain, e := c.ListChain(t, name); e == nil && chain.Hooknum != nil {
			return true
		}
	}
	return false
}
func (g *blacklistGuard) cleanupStage(name string) {
	c, e := newNftConn()
	if e != nil {
		return
	}
	t, e := c.ListTableOfFamily(name, nftables.TableFamilyINet)
	if e == nil && g.owned(c, t) == nil && !g.isActive(c, t) {
		c.DelTable(t)
		_ = c.Flush()
	}
}
