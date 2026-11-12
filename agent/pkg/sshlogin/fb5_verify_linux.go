package sshlogin

import (
	"context"
	"encoding/json"
	"fmt"
	"net/netip"
	"strings"
	"time"
)

// Fail2ban's in-memory ban list may update before its action runs. A cutover
// verifies the owned kernel sets/chains before retiring the old protection.
func (g *banGuard) verifyFB5Bans(ctx context.Context, p Policy, entries []BanEntry) error {
	want := map[string]bool{}
	for _, entry := range entries {
		ip, e := netip.ParseAddr(entry.IP)
		if e != nil {
			return e
		}
		if !p.allowed(ip) && (entry.ExpiresAt < 0 || entry.ExpiresAt > time.Now().UnixMilli()) {
			want[ip.Unmap().String()] = true
		}
	}
	if len(want) == 0 {
		return nil
	}
	script, e := g.fb5Script()
	if e != nil {
		return e
	}
	out, e := g.Exec(ctx, "/bin/sh", script, "firewall")
	if e != nil {
		return e
	}
	backend := strings.TrimSpace(string(out))
	key := strings.TrimPrefix(g.Name, "ddnezha-ssh-")
	for attempt := 0; attempt < 20; attempt++ {
		found := map[string]int{}
		expected := 1
		if backend == "nftables" {
			data, err := g.Exec(ctx, "nft", "-j", "list", "table", "inet", "f2b_ddnz_auto_"+key)
			if err == nil {
				var doc struct {
					NFT []struct {
						Set *struct {
							Name string
							Elem []json.RawMessage
						} `json:"set"`
					} `json:"nftables"`
				}
				if json.Unmarshal(data, &doc) == nil {
					for _, item := range doc.NFT {
						if item.Set == nil || (item.Set.Name != "addr-set-ddnz-"+key && item.Set.Name != "addr6-set-ddnz-"+key) {
							continue
						}
						for _, raw := range item.Set.Elem {
							var ip string
							if json.Unmarshal(raw, &ip) != nil {
								var x struct{ Elem struct{ Val string } }
								if json.Unmarshal(raw, &x) == nil {
									ip = x.Elem.Val
								}
							}
							if a, err := netip.ParseAddr(ip); err == nil {
								found[a.Unmap().String()] = 1
							}
						}
					}
				}
			}
		} else if backend == "iptables" {
			expected = (len(p.Ports) + 14) / 15
			for _, tool := range []string{"iptables", "ip6tables"} {
				for chunk := 0; chunk < expected; chunk++ {
					chain := fmt.Sprintf("f2b-ddnz%s%d", key, chunk)
					data, err := g.Exec(ctx, tool, "-w", "5", "-S", chain)
					if err != nil {
						continue
					}
					for _, line := range strings.Split(string(data), "\n") {
						fields := strings.Fields(line)
						if len(fields) < 6 || fields[0] != "-A" || fields[1] != chain {
							continue
						}
						blocks := false
						for i := 2; i < len(fields)-1; i++ {
							if fields[i] == "-j" && (fields[i+1] == "DROP" || fields[i+1] == "REJECT") {
								blocks = true
							}
						}
						if !blocks {
							continue
						}
						for i := 2; i < len(fields)-1; i++ {
							if fields[i] == "-s" {
								value := strings.Split(fields[i+1], "/")[0]
								if a, err := netip.ParseAddr(value); err == nil {
									found[a.Unmap().String()]++
								}
							}
						}
					}
				}
			}
		} else {
			return fmt.Errorf("无法确认 Fail2ban 防火墙")
		}
		ready := true
		for ip := range want {
			if found[ip] < expected {
				ready = false
				break
			}
		}
		if ready {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
	return fmt.Errorf("Fail2ban 封禁规则尚未生效，原防护保留")
}
