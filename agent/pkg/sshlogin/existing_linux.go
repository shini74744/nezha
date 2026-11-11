package sshlogin

import (
	"context"
	"net/netip"
	"regexp"
	"strconv"
	"strings"
)

var safeActionName = regexp.MustCompile("^[a-zA-Z0-9_.-]{1,100}$")

func (g *banGuard) existing(ctx context.Context) *ExistingSSH {
	if _, err := g.Exec(ctx, "fail2ban-client", "status", "sshd"); err != nil {
		return nil
	}
	info := &ExistingSSH{Active: true, Ports: []uint16{}, Allowlist: []string{}}
	for _, v := range []struct {
		field string
		value *int
	}{{"maxretry", &info.MaxRetry}, {"findtime", &info.FindTime}, {"bantime", &info.BanTime}} {
		out, e := g.Exec(ctx, "fail2ban-client", "get", "sshd", v.field)
		if e == nil {
			*v.value, _ = strconv.Atoi(strings.TrimSpace(string(out)))
		}
	}
	if out, e := g.Exec(ctx, "fail2ban-client", "get", "sshd", "ignoreip"); e == nil {
		for _, raw := range strings.Fields(strings.NewReplacer("[", " ", "]", " ", ",", " ", "'", " ", "\"", " ").Replace(string(out))) {
			if a, e := netip.ParseAddr(raw); e == nil && a.Zone() == "" {
				info.Allowlist = append(info.Allowlist, a.Unmap().String())
				continue
			}
			if p, e := netip.ParsePrefix(raw); e == nil {
				info.Allowlist = append(info.Allowlist, p.Masked().String())
			}
		}
	}
	if out, e := g.Exec(ctx, "fail2ban-client", "get", "sshd", "actions"); e == nil {
		seen := map[uint16]bool{}
		text := string(out)
		if at := strings.Index(text, "following actions:"); at >= 0 {
			text = text[at+len("following actions:"):]
		}
		out = []byte(text)
		actions := strings.Fields(strings.NewReplacer("[", " ", "]", " ", ",", " ", "'", " ", "\"", " ").Replace(string(out)))
		if len(actions) > 16 {
			return info
		}
		for _, raw := range actions {
			if !safeActionName.MatchString(raw) {
				continue
			}
			ports, e := g.Exec(ctx, "fail2ban-client", "get", "sshd", "action", raw, "port")
			if e != nil {
				continue
			}
			for _, v := range strings.FieldsFunc(string(ports), func(r rune) bool { return r == ',' || r == ' ' || r == '\n' }) {
				if v == "ssh" {
					v = "22"
				}
				n, e := strconv.ParseUint(v, 10, 16)
				if e == nil && n > 0 && !seen[uint16(n)] {
					info.Ports = append(info.Ports, uint16(n))
					seen[uint16(n)] = true
				}
			}
			if len(info.Ports) > 0 {
				break
			}
		}
	}
	return info
}
func (g *banGuard) target() string {
	if g.Reused {
		return "sshd"
	}
	return g.Name
}
