package sshlogin

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSSHKernelExistingFail2banMigration(t *testing.T) {
	isolatedKernelTest(t)
	if _, e := exec.LookPath("fail2ban-client"); e != nil {
		t.Skip("Fail2ban fixture binary unavailable")
	}
	root := t.TempDir()
	stateDir := t.TempDir()
	for _, d := range []string{"filter.d", "jail.d", "action.d"} {
		if e := os.Mkdir(filepath.Join(root, d), 0700); e != nil {
			t.Fatal(e)
		}
	}
	write := func(path, content string) {
		t.Helper()
		if e := os.WriteFile(filepath.Join(root, path), []byte(content), 0600); e != nil {
			t.Fatal(e)
		}
	}
	write("fail2ban.conf", fmt.Sprintf("[Definition]\nsyslogsocket=auto\nallowipv6=auto\nloglevel=ERROR\nlogtarget=%s\nsocket=%s\npidfile=%s\ndbfile=%s\ndbpurgeage=86400\n", filepath.Join(root, "fail2ban.log"), filepath.Join(root, "socket"), filepath.Join(root, "pid"), filepath.Join(root, "sqlite.db")))
	write("filter.d/fixture.conf", "[Definition]\nfailregex = ^failure <HOST>$\nignoreregex =\n")
	write("action.d/fixture.conf", "[Definition]\nactionstart =\nactionstop =\nactioncheck =\nactionban =\nactionunban =\n[Init]\nport = 22\n")
	write("ssh.log", "")
	write("xui.log", "")
	original := fmt.Sprintf("[DEFAULT]\nbackend=polling\nusedns=no\nbantime=3600\nfindtime=600\nmaxretry=3\nignoreip=127.0.0.0/8 ::1 192.0.2.11\n[sshd]\nenabled=true\nfilter=fixture\nport=2222\nlogpath=%s\naction=fixture[port=\"%%(port)s\"]\n[3xui-login]\nenabled=true\nfilter=fixture\nlogpath=%s\nport=744\naction=fixture[port=\"%%(port)s\"]\n", filepath.Join(root, "ssh.log"), filepath.Join(root, "xui.log"))
	write("jail.local", original)
	invoke := func(ctx context.Context, name string, args ...string) ([]byte, error) {
		if name != "fail2ban-client" {
			return nil, fmt.Errorf("unexpected executable %s", name)
		}
		prefix := []string{"-c", root, "-s", filepath.Join(root, "socket"), "-p", filepath.Join(root, "pid")}
		ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		return exec.CommandContext(ctx, name, append(prefix, args...)...).Output()
	}
	ctx := context.Background()
	if out, e := invoke(ctx, "fail2ban-client", "-x", "start"); e != nil {
		t.Fatalf("private fixture failed to start: %v %s", e, out)
	}
	defer invoke(ctx, "fail2ban-client", "stop")
	for _, command := range [][]string{{"set", "sshd", "banip", "198.51.100.21"}, {"set", "3xui-login", "banip", "203.0.113.21"}} {
		if out, e := invoke(ctx, "fail2ban-client", command...); e != nil {
			t.Fatalf("private ban fixture: %v %s", e, out)
		}
	}
	time.Sleep(200 * time.Millisecond)
	g := banGuard{Name: "ddnezha-ssh-0123456789abcdef", Dir: stateDir, Root: root, Exec: invoke}
	t.Logf("detected existing params: %+v", g.existing(ctx))
	m, e := g.prepareMigration(ctx)
	if e != nil || m == nil {
		t.Fatalf("backup: %v %+v", e, m)
	}
	if m.Info.MaxRetry != 3 || m.Info.FindTime != 600 || len(m.Info.Ports) != 1 || m.Info.Ports[0] != 2222 {
		t.Fatalf("original params not captured %+v", m.Info)
	}
	p := initialPolicy()
	p.Enabled = true
	p.AutoBan = true
	p.Ports = m.Info.Ports
	p.Allowlist = m.Info.Allowlist
	hashPrefixes(&p, nil)
	native := blacklistGuard{Name: "ddnz_ssh_0123456789abcdef"}
	applied := false
	e = g.cutover(ctx, m, func(snapshot *migrationSnapshot) error {
		if len(snapshot.Bans) != 1 {
			t.Fatalf("missing original bans %+v", snapshot.Bans)
		}
		if e := native.apply(ctx, p, nil, snapshot.Bans); e != nil {
			return e
		}
		bans, e := native.banned()
		if e != nil || len(bans) != 1 {
			return fmt.Errorf("native ban receipt: %v %v", bans, e)
		}
		applied = true
		return nil
	})
	if e != nil {
		t.Fatal(e)
	}
	if !applied || !m.Complete {
		t.Fatal("migration not confirmed")
	}
	if _, e = invoke(ctx, "fail2ban-client", "status", "sshd"); e == nil {
		t.Fatal("old SSH jail still active")
	}
	xui, e := invoke(ctx, "fail2ban-client", "get", "3xui-login", "banip")
	if e != nil || !strings.Contains(string(xui), "203.0.113.21") {
		t.Fatalf("XUI jail/bans changed %s %v", xui, e)
	}
	current, e := os.ReadFile(filepath.Join(root, "jail.local"))
	if e != nil || string(current) != original {
		t.Fatal("original config modified")
	}
	reloaded, e := g.prepareMigration(ctx)
	if e != nil || !reloaded.Complete {
		t.Fatalf("migration receipt did not survive restart: %v", e)
	}
	if e = g.cutover(ctx, reloaded, func(*migrationSnapshot) error { t.Fatal("completed migration applied twice"); return nil }); e != nil {
		t.Fatal(e)
	}
	p.Enabled = false
	if e = native.apply(ctx, p, nil, nil); e != nil {
		t.Fatal(e)
	}
	t.Log("PASS: actual isolated Fail2ban backup, original params/bans, native apply before stop, persistent old-SSH disable, XUI preservation, restart receipt")
}
