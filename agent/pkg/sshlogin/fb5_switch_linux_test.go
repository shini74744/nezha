package sshlogin

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSSHKernelBackendSwitchAndFailure(t *testing.T) {
	isolatedKernelTest(t)
	addLoopbackAddress(t, "192.0.2.10")
	addLoopbackAddress(t, "192.0.2.11")
	addLoopbackAddress(t, "192.0.2.12")
	addLoopbackAddress(t, "192.0.2.13")
	target, port := tcpFixture(t, "tcp4", "192.0.2.10:0")
	business, _ := tcpFixture(t, "tcp4", "192.0.2.10:0")
	g, source := privateFB5Fixture(t, "nftables")
	key := strings.TrimPrefix(g.Name, "ddnezha-ssh-")
	b := blacklistGuard{Name: "ddnz_ssh_" + key}
	p := initialPolicy()
	p.Enabled = true
	p.AutoBan = true
	p.Ports = []uint16{port}
	p.BanTime = -1
	p.Revision = 1
	prefixes := []string{"192.0.2.13/32"}
	p.BlockHash = fmt.Sprintf("%x", sha256.Sum256([]byte(strings.Join(prefixes, "\n"))))
	s := savedState{Policy: p, AppliedPolicy: &p, Prefixes: prefixes, AppliedPrefixes: prefixes}
	s.Native.initialize()
	s.Native.Bans["192.0.2.11"] = -1
	s.Native.BanStarts["192.0.2.11"] = time.Now().Add(-time.Hour).UnixMilli()
	ctx := context.Background()
	save := func() error { return nil }
	if e := applyNativeBackend(ctx, &s, &g, &b, p, save); e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { off := p; off.Enabled = false; off.BlockHash = ""; b.apply(ctx, off, nil, nil) })
	expectFrom(t, "tcp4", target, "192.0.2.11", false)
	original := g.Exec
	idleState := ""
	g.Exec = func(c context.Context, cmd string, args ...string) ([]byte, error) {
		out, err := original(c, cmd, args...)
		// Fail2ban 1.0 returns actual idle state from SET, but has no GET idle.
		if err == nil && cmd == "fail2ban-client" && len(args) == 4 && args[0] == "set" && args[1] == g.Name && args[2] == "idle" {
			idleState = strings.TrimSpace(strings.ToLower(string(out)))
		}
		return out, err
	}
	broken := g
	broken.Exec = func(c context.Context, cmd string, args ...string) ([]byte, error) {
		if cmd == "/bin/sh" && len(args) > 1 && args[1] == "firewall" {
			return nil, fmt.Errorf("fixture missing dependency")
		}
		return original(c, cmd, args...)
	}
	f2b := p
	f2b.Backend = "fail2ban"
	f2b.Revision++
	if e := applyFB5Backend(ctx, &s, &broken, &b, f2b, source, save); e == nil {
		t.Fatal("failed switch accepted")
	}
	expectFrom(t, "tcp4", target, "192.0.2.11", false)
	expectFrom(t, "tcp4", business, "192.0.2.11", true)
	b.HadRules = false // interrupted persistence must not leave an old native table
	if e := applyFB5Backend(ctx, &s, &g, &b, f2b, source, save); e != nil {
		t.Fatal(e)
	}
	s.AppliedPolicy = &f2b
	s.Policy = f2b
	time.Sleep(700 * time.Millisecond)
	if b.HadRules {
		t.Fatal("native rules remained after Fail2ban cutover")
	}
	remaining, err := g.Exec(ctx, "nft", "list", "tables")
	if err != nil || strings.Contains(string(remaining), b.Name) {
		t.Fatal("native table survived cutover", err)
	}
	expectFrom(t, "tcp4", target, "192.0.2.13", false)
	expectFrom(t, "tcp4", business, "192.0.2.13", true)
	expectFrom(t, "tcp4", target, "192.0.2.11", false)
	expectFrom(t, "tcp4", business, "192.0.2.11", true)
	// Restarting Agent must not reset the selected backend or require native rules.
	statePath := filepath.Join(t.TempDir(), "state.json")
	encoded, e := json.Marshal(s)
	if e != nil {
		t.Fatal(e)
	}
	os.WriteFile(statePath, encoded, 0600)
	var restored savedState
	json.Unmarshal(encoded, &restored)
	if restored.applied().Engine() != "fail2ban" {
		t.Fatal("backend lost")
	}
	// Simulate termination during import: neither a paused detector nor a
	// temporary ban duration may remain after recovery.
	if _, e := g.Exec(ctx, "fail2ban-client", "set", g.Name, "idle", "on"); e != nil {
		t.Fatal(e)
	}
	if _, e := g.Exec(ctx, "fail2ban-client", "set", g.Name, "bantime", "999"); e != nil {
		t.Fatal(e)
	}
	if e := applyFB5Backend(ctx, &restored, &g, &b, f2b, source, save); e != nil {
		t.Fatal(e)
	}
	for field, expected := range map[string]string{"bantime": "-1"} {
		out, e := g.Exec(ctx, "fail2ban-client", "get", g.Name, field)
		if e != nil || strings.TrimSpace(strings.ToLower(string(out))) != expected {
			t.Fatalf("recovery did not restore %s: %s %v", field, out, e)
		}
	}
	if idleState != "false" {
		t.Fatal("recovery left Fail2ban paused", idleState)
	}
	badNative := p
	badNative.BlockHash = strings.Repeat("0", 64)
	if e := applyNativeBackend(ctx, &restored, &g, &b, badNative, save); e == nil {
		t.Fatal("bad native cutover accepted")
	}
	if idleState != "false" {
		t.Fatal("failed cutover left Fail2ban paused", idleState)
	}
	expectFrom(t, "tcp4", target, "192.0.2.11", false)
	// A new ban after a UI read must not disappear during backend cutover.
	if _, e := g.readFB5Bans(ctx, time.Now()); e != nil {
		t.Fatal(e)
	}
	if _, e := g.Exec(ctx, "fail2ban-client", "set", g.Name, "banip", "192.0.2.12"); e != nil {
		t.Fatal(e)
	}
	// Return to native only after the imported bans are verified there.
	p.Revision = 3
	if e := applyNativeBackend(ctx, &restored, &g, &b, p, save); e != nil {
		t.Fatal(e)
	}
	restored.AppliedPolicy = &p
	expectFrom(t, "tcp4", target, "192.0.2.12", false)
	if restored.Native.Bans["192.0.2.12"] != -1 {
		t.Fatal("cached ban snapshot used during cutover")
	}
	expectFrom(t, "tcp4", target, "192.0.2.11", false)
	expectFrom(t, "tcp4", business, "192.0.2.11", true)
	if _, e := g.Exec(ctx, "fail2ban-client", "status", g.Name); e == nil {
		t.Fatal("old Fail2ban jail remains active")
	}
	if restored.Native.BanStarts["192.0.2.11"] != s.Native.BanStarts["192.0.2.11"] {
		t.Fatal("original ban time lost")
	}
	if restored.Native.Bans["192.0.2.11"] != -1 {
		t.Fatal("permanent ban lost")
	}
}
