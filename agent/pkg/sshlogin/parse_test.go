package sshlogin

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestSSHParseTrustedMessages(t *testing.T) {
	cases := []struct {
		line, user, ip, method string
		success                bool
	}{
		{"Accepted password for alice from 192.0.2.1 port 45001 ssh2", "alice", "192.0.2.1", "password", true},
		{"Failed password for invalid user test from 2001:db8::1 port 45001 ssh2", "test", "2001:db8::1", "password", false},
		{"Accepted publickey for root from ::ffff:192.0.2.2 port 45001 ssh2: ED25519 SHA256:secret-fingerprint", "root", "192.0.2.2", "publickey", true},
		{"Failed keyboard-interactive/pam for root from 192.0.2.3 port 45001 ssh2", "root", "192.0.2.3", "keyboard-interactive/pam", false},
		{"Password auth succeeded for 'alice' from 192.0.2.1:45001", "alice", "192.0.2.1", "password", true},
		{"Bad password attempt for 'root' from [2001:db8::2]:45001", "root", "2001:db8::2", "password", false},
		{"Pubkey auth succeeded for 'root' with key SHA256:secret-fingerprint from 192.0.2.1:45001", "root", "192.0.2.1", "publickey", true},
	}
	for _, c := range cases {
		t.Run(c.line, func(t *testing.T) {
			e, ok := Parse(c.line, time.Unix(100, 0))
			if !ok || e.Username != c.user || e.SourceIP != c.ip || e.Method != c.method || e.Success != c.success || e.SourcePort != 45001 || e.Port != 0 {
				t.Fatalf("wrong event: %+v %v", e, ok)
			}
			b, _ := json.Marshal(e)
			if strings.Contains(string(b), "secret-fingerprint") {
				t.Fatal("retained log tail")
			}
		})
	}
	for _, line := range []string{
		"Failed password for root from bad-ip port 22 ssh2",
		"Failed password for root from 192.0.2.1 port 65536 ssh2",
		"Failed password for root from 192.0.2.1 port 0 ssh2",
		"Failed password for r\noot from 192.0.2.1 port 22 ssh2",
		"Failed password for root from 0.0.0.0 port 22 ssh2",
		"Partial publickey for root from 192.0.2.1 port 22 ssh2",
		"Connection closed by authenticating user root 192.0.2.1 port 22 [preauth]",
		"arbitrary " + strings.Repeat("x", 17000),
	} {
		if _, ok := Parse(line, time.Now()); ok {
			t.Fatalf("accepted invalid line %q", line)
		}
	}
}
func TestSSHPortAndAllowlistProtection(t *testing.T) {
	p := Policy{Enabled: true, AutoBan: true, Ports: []uint16{2222}, Allowlist: []string{"192.0.2.0/24", "2001:db8::/32"}}
	e := Event{SourceIP: "198.51.100.1", SourcePort: 2222, Port: 22}
	if p.Protected(e) {
		t.Fatal("client source port used as local port")
	}
	e.Port = 2222
	if !p.Protected(e) {
		t.Fatal("selected local port ignored")
	}
	for _, ip := range []string{"127.0.0.1", "::1", "192.0.2.99", "::ffff:192.0.2.99", "2001:db8::123"} {
		e.SourceIP = ip
		if p.Protected(e) {
			t.Fatalf("allowlist failed for %s", ip)
		}
	}
	e.SourceIP = "198.51.100.1"
	e.Port = 0
	if p.Protected(e) {
		t.Fatal("unknown local port can cause ban")
	}
	e.Port = 2222
	e.Success = true
	if p.Protected(e) {
		t.Fatal("success can cause ban")
	}
}
