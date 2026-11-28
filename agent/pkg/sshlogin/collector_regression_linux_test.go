package sshlogin

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func logLine(user string) string {
	return time.Now().Format(time.RFC3339) + " fixture sshd[123]: Failed password for " + user + " from 192.0.2.10 port 50000 ssh2\n"
}
func TestSSHLogRotationPartialTruncationAndBoundedLine(t *testing.T) {
	path := filepath.Join(t.TempDir(), "auth.log")
	put := func(p, s string) {
		t.Helper()
		if e := os.WriteFile(p, []byte(s), 0600); e != nil {
			t.Fatal(e)
		}
	}
	add := func(s string) {
		t.Helper()
		f, e := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0600)
		if e != nil {
			t.Fatal(e)
		}
		defer f.Close()
		if _, e = f.WriteString(s); e != nil {
			t.Fatal(e)
		}
	}
	put(path, logLine("old"))
	st, _ := os.Stat(path)
	c := collector{Cursor: cursor{Source: path, Started: true, Offset: st.Size(), Inode: inode(st)}}
	events, e := c.file(10)
	if e != nil || len(events) != 0 {
		t.Fatal("historical replay", e, events)
	}
	line := logLine("partial")
	add(strings.TrimSuffix(line, "\n"))
	events, e = c.file(10)
	if e != nil || len(events) != 0 {
		t.Fatal("partial line consumed")
	}
	add("\n")
	events, e = c.file(10)
	if e != nil || len(events) != 1 || events[0].Username != "partial" {
		t.Fatal(e, events)
	}
	add(logLine("rotated"))
	if e = os.Rename(path, path+".1"); e != nil {
		t.Fatal(e)
	}
	put(path, logLine("current"))
	events, e = c.file(10)
	if e != nil || len(events) != 1 || events[0].Username != "rotated" {
		t.Fatal("rotation lost old tail", e, events)
	}
	events, e = c.file(10)
	if e != nil || len(events) != 1 || events[0].Username != "current" {
		t.Fatal("rotation lost new file", e, events)
	}
	put(path, "")
	_, e = c.file(10)
	if e != nil {
		t.Fatal(e)
	}
	add(strings.Repeat("x", 5<<20) + "\n" + logLine("after-large-line"))
	total := 0
	for i := 0; i < 5; i++ {
		before := c.Cursor.Offset
		events, e = c.file(10)
		if e != nil {
			t.Fatal(e)
		}
		if c.Cursor.Offset-before > 2<<20+65536 {
			t.Fatal("unbounded per-poll read")
		}
		total += len(events)
	}
	if total != 1 {
		t.Fatalf("long line should be skipped and next auth event recovered, got %d", total)
	}
}
func TestSSHMigrationPauseRecoveryAndAllowlistEditing(t *testing.T) {
	root := t.TempDir()
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(root, "jail.d"), 0700)
	os.MkdirAll(filepath.Join(dir, "migration"), 0700)
	calls := []string{}
	g := banGuard{Name: "ddnezha-ssh-0123456789abcdef", Root: root, Dir: dir, Exec: func(_ context.Context, _ string, args ...string) ([]byte, error) {
		calls = append(calls, strings.Join(args, " "))
		if strings.Join(args, " ") == "status" {
			return []byte("`- Jail list: sshd\n"), nil
		}
		return []byte("ok"), nil
	}}
	m := &migrationSnapshot{Paused: true, PolicyRevision: 7, Files: map[string]string{}, Info: ExistingSSH{Allowlist: []string{"192.0.2.10"}}}
	if e := g.saveMigration(m); e != nil {
		t.Fatal(e)
	}
	recovered, e := g.prepareMigrationRecovery(context.Background())
	if e != nil || recovered.Paused {
		t.Fatal(e, recovered)
	}
	if strings.Join(calls, ";") != "status;set sshd idle off" {
		t.Fatal(calls)
	}
	p := initialPolicy()
	p.Revision = 7
	if len(effectivePolicy(p, m).Allowlist) != 1 {
		t.Fatal("initial imported whitelist missing")
	}
	p.Revision = 8
	if len(effectivePolicy(p, m).Allowlist) != 0 {
		t.Fatal("later explicit whitelist edit ignored")
	}
}
func TestSSHPolicyDisabledCanExitWhitelistOnly(t *testing.T) {
	p := initialPolicy()
	p.WhitelistOnly = true
	if e := p.Validate(); e != nil {
		t.Fatal("disabled policy should allow leaving whitelist-only mode", e)
	}
	p.Enabled = true
	if e := p.Validate(); e == nil {
		t.Fatal("empty enabled whitelist accepted")
	}
	p.Allowlist = []string{"2001:db8::/32"}
	if e := p.Validate(); e != nil {
		t.Fatal(e)
	}
}
func TestSSHMigrationApplyFailureKeepsOldProtection(t *testing.T) {
	root := t.TempDir()
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(root, "jail.d"), 0700)
	os.MkdirAll(filepath.Join(dir, "migration"), 0700)
	calls := []string{}
	g := banGuard{Name: "ddnezha-ssh-0123456789abcdef", Root: root, Dir: dir, Exec: func(_ context.Context, _ string, args ...string) ([]byte, error) {
		s := strings.Join(args, " ")
		calls = append(calls, s)
		if s == "status" {
			return []byte("`- Jail list: sshd\n"), nil
		}
		if s == "get sshd idle" {
			return []byte("False\n"), nil
		}
		if s == "get sshd banip --with-time" {
			return nil, nil
		}
		return []byte("ok"), nil
	}}
	m := &migrationSnapshot{Files: map[string]string{}}
	e := g.cutover(context.Background(), m, func(*migrationSnapshot) error { return fmt.Errorf("fixture: native apply failed") })
	if e == nil || m.Complete || m.Paused {
		t.Fatal("failed handover must remain recoverable", e, m)
	}
	for _, s := range calls {
		if s == "stop sshd" {
			t.Fatal("old protection stopped before verified replacement")
		}
	}
	if calls[len(calls)-1] != "set sshd idle off" {
		t.Fatal("old detection not resumed", calls)
	}
	if _, e = os.Stat(g.migrationOverlay()); !os.IsNotExist(e) {
		t.Fatal("failed handover left disabled old jail")
	}
}

func TestLegacySSHDiscoveryAfterNativeMigration(t *testing.T) {
	ctx := context.Background()
	list := "sshd-other, 3xui-login"
	queries := 0
	g := banGuard{Root: t.TempDir(), Exec: func(_ context.Context, command string, args ...string) ([]byte, error) {
		if command != "fail2ban-client" || strings.Join(args, " ") != "status" {
			t.Fatalf("unexpected jail query: %s %v", command, args)
		}
		queries++
		return []byte("Status\n|- Number of jail: 2\n`- Jail list:\t" + list + "\n"), nil
	}}
	apply := func(*migrationSnapshot) error { t.Fatal("reapplied completed migration"); return nil }
	if g.existing(ctx) != nil || g.existing(ctx) != nil {
		t.Fatal("other SSH jail mistaken for legacy sshd")
	}
	if err := g.cutover(ctx, &migrationSnapshot{Complete: true}, apply); err != nil || queries != 1 {
		t.Fatalf("completed migration: %v, queries=%d", err, queries)
	}
	list = ""
	g.legacyAbsentUntil = time.Time{}
	if g.existing(ctx) != nil {
		t.Fatal("empty jail list should be inactive")
	}
	list = "sshd-other, sshd"
	g.legacyAbsentUntil = time.Time{}
	if err := g.cutover(ctx, &migrationSnapshot{Complete: true}, apply); err == nil {
		t.Fatal("externally re-enabled sshd was not detected")
	}
}

func TestCompletedNativeMigrationWithoutFail2ban(t *testing.T) {
	g := banGuard{Root: filepath.Join(t.TempDir(), "removed"), Exec: func(context.Context, string, ...string) ([]byte, error) {
		return nil, os.ErrNotExist
	}}
	err := g.cutover(context.Background(), &migrationSnapshot{Complete: true}, func(*migrationSnapshot) error {
		t.Fatal("attempted to migrate a removed jail")
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(g.Root); !os.IsNotExist(err) {
		t.Fatalf("recreated Fail2ban directory: %v", err)
	}
}

func TestLegacySSHAmbiguousRecoveryKeepsReceipt(t *testing.T) {
	g := banGuard{Exec: func(context.Context, string, ...string) ([]byte, error) { return []byte("unexpected output"), nil }}
	m := &migrationSnapshot{Paused: true}
	if err := g.recoverPause(context.Background(), m); err == nil || !m.Paused || !g.legacyAbsentUntil.IsZero() {
		t.Fatalf("unconfirmed recovery: %v, paused=%t", err, m.Paused)
	}
}
