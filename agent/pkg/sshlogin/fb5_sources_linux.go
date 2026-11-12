package sshlogin

import (
	"crypto/sha256"
	"fmt"
	"net/netip"
	"slices"
	"strconv"
	"strings"
)

// These scripts are invoked by the Fail2ban action, not the native netlink
// backend. All generated tokens are canonical addresses, ports or hashes.
// They own one INPUT filter table/chain and never touch NAT/FORWARD/bridges/netns.
func fail2banSources(p Policy, prefixes []string, key, firewall string) (string, error) {
	if len(key) != 16 || strings.Trim(key, "0123456789abcdef") != "" {
		return "", fmt.Errorf("invalid instance")
	}
	if e := p.Validate(); e != nil {
		return "", e
	}
	allow := append([]string{"127.0.0.0/8", "::1/128"}, p.Allowlist...)
	normalize := func(raw []string) ([]string, error) {
		out := []string{}
		for _, v := range raw {
			if a, e := netip.ParseAddr(v); e == nil && a.Zone() == "" {
				out = append(out, a.Unmap().String())
				continue
			}
			a, e := netip.ParsePrefix(v)
			if e != nil || a.Addr().Is4In6() {
				return nil, fmt.Errorf("来源地址无效")
			}
			out = append(out, a.Masked().String())
		}
		slices.Sort(out)
		return slices.Compact(out), nil
	}
	var e error
	if allow, e = normalize(allow); e != nil {
		return "", e
	}
	if prefixes, e = normalize(prefixes); e != nil {
		return "", e
	}
	ports := []string{}
	for _, v := range p.Ports {
		ports = append(ports, strconv.Itoa(int(v)))
	}
	signature := fmt.Sprintf("%x", sha256.Sum256([]byte(fmt.Sprint(allow, prefixes, ports, p.WhitelistOnly))))
	owner := "ddnezha-source-" + key
	marker := owner + "-" + signature
	if firewall == "nftables" {
		table := "f2b_ddnz_source_" + key
		var rules strings.Builder
		rules.WriteString(fmt.Sprintf("table inet %s {\n chain ssh {\n type filter hook input priority -1; policy accept;\n comment \"%s\"\n", table, marker))
		for _, pair := range []struct {
			items   []string
			verdict string
		}{{allow, "return"}, {prefixes, "drop"}} {
			for _, v := range pair.items {
				family := "ip"
				if strings.Contains(v, ":") {
					family = "ip6"
				}
				rules.WriteString(fmt.Sprintf("tcp dport { %s } %s saddr %s %s\n", strings.Join(ports, ", "), family, v, pair.verdict))
			}
		}
		if p.WhitelistOnly {
			rules.WriteString(fmt.Sprintf("tcp dport { %s } drop\n", strings.Join(ports, ", ")))
		}
		rules.WriteString("}\n}\n")
		return fmt.Sprintf(`#!/bin/sh
set -eu
owned() { nft list table inet %s 2>/dev/null | grep -Fq '%s-'; }
case "$1" in
start)
 old=''
 if nft list table inet %s >/dev/null 2>&1; then owned || exit 1; old='delete table inet %s'; fi
 {
  [ -z "$old" ] || printf '%%s\n' "$old"
  cat <<'DDNZ_RULES'
%sDDNZ_RULES
 } | nft -f -
 ;;
check) nft list table inet %s | grep -Fq '%s' ;;
stop)
 if nft list table inet %s >/dev/null 2>&1; then owned || exit 1; nft delete table inet %s; fi
 ;;
*) exit 1;;
esac
`, table, owner, table, table, rules.String(), table, marker, table, table), nil
	}
	if firewall != "iptables" {
		return "", fmt.Errorf("不支持的 SSH 防火墙")
	}
	chain := "ddnzS" + key
	body := "#!/bin/sh\nset -eu\ncase \"$1\" in\nstart)\n"
	for _, ipv6 := range []bool{false, true} {
		tool, restore := "iptables", "iptables-restore"
		if ipv6 {
			tool, restore = "ip6tables", "ip6tables-restore"
		}
		// A pre-existing chain without our ownership marker is never overwritten.
		body += fmt.Sprintf("if %s -w 5 -S %s >/dev/null 2>&1; then %s -w 5 -S %s | grep -Fq '%s-' || exit 1; fi\n", tool, chain, tool, chain, owner)
		var rules strings.Builder
		rules.WriteString(fmt.Sprintf("*filter\n:%s - [0:0]\n-F %s\n-A %s -m comment --comment %s\n", chain, chain, chain, marker))
		for start := 0; start < len(ports); start += 15 {
			portList := strings.Join(ports[start:min(start+15, len(ports))], ",")
			match := fmt.Sprintf("-p tcp -m multiport --dports %s", portList)
			for _, pair := range []struct {
				items   []string
				verdict string
			}{{allow, "RETURN"}, {prefixes, "DROP"}} {
				for _, v := range pair.items {
					if strings.Contains(v, ":") == ipv6 {
						rules.WriteString(fmt.Sprintf("-A %s %s -s %s -j %s\n", chain, match, v, pair.verdict))
					}
				}
			}
			if p.WhitelistOnly {
				rules.WriteString(fmt.Sprintf("-A %s %s -j DROP\n", chain, match))
			}
		}
		rules.WriteString("COMMIT\n")
		body += fmt.Sprintf("%s -w 5 --noflush <<'DDNZ_RULES'\n%sDDNZ_RULES\n%s -w 5 -C INPUT -j %s 2>/dev/null || %s -w 5 -I INPUT -j %s\n", restore, rules.String(), tool, chain, tool, chain)
	}
	body += ";;\ncheck)\n"
	for _, tool := range []string{"iptables", "ip6tables"} {
		body += fmt.Sprintf("%s -w 5 -C INPUT -j %s\n%s -w 5 -S %s | grep -Fq '%s'\n", tool, chain, tool, chain, marker)
	}
	body += ";;\nstop)\n"
	for _, tool := range []string{"iptables", "ip6tables"} {
		body += fmt.Sprintf("if %s -w 5 -S %s >/dev/null 2>&1; then\n %s -w 5 -S %s | grep -Fq '%s-' || exit 1\n while %s -w 5 -C INPUT -j %s 2>/dev/null; do %s -w 5 -D INPUT -j %s; done\n %s -w 5 -F %s\n %s -w 5 -X %s\nfi\n", tool, chain, tool, chain, owner, tool, chain, tool, chain, tool, chain, tool, chain)
	}
	return body + ";;\n*) exit 1;;\nesac\n", nil
}
