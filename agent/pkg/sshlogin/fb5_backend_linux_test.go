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

	"github.com/nezhahq/agent/scripts/sshsecurity"
)

func TestFB5ScriptPlansAndBoundaries(t *testing.T) {
	dir := t.TempDir()
	script := filepath.Join(dir, "ssh.sh")
	if e := os.WriteFile(script, sshsecurity.Script, 0600); e != nil {
		t.Fatal(e)
	}
	for _, test := range []struct{ id, want string }{{"debian", "apt-get"}, {"ubuntu", "apt-get"}, {"alpine", "apk add"}, {"fedora", "dnf"}, {"rocky", "install epel-release"}, {"opensuse-leap", "zypper"}, {"unknown", ""}} {
		t.Run(test.id, func(t *testing.T) {
			release := filepath.Join(dir, "release")
			_ = os.WriteFile(release, []byte("ID="+test.id+"\n"), 0600)
			out, e := exec.Command("/bin/sh", script, "--plan", release).CombinedOutput()
			if test.want == "" {
				if e == nil {
					t.Fatal("unsupported OS accepted")
				}
				return
			}
			if e != nil || !strings.Contains(string(out), test.want) {
				t.Fatalf("%s %v", out, e)
			}
			for _, bad := range []string{" upgrade", " autoremove", " dist-upgrade", " purge"} {
				if strings.Contains(string(out), bad) {
					t.Fatalf("unsafe package plan %s", out)
				}
			}
		})
	}
	// RHEL derivatives commonly also list Fedora in ID_LIKE. They still
	// need EPEL and must not take the Fedora-only installation branch.
	release := filepath.Join(dir, "release")
	_ = os.WriteFile(release, []byte("ID=rocky\nID_LIKE=\"rhel centos fedora\"\n"), 0600)
	out, e := exec.Command("/bin/sh", script, "--plan", release).CombinedOutput()
	if e != nil || !strings.Contains(string(out), "install epel-release") {
		t.Fatalf("RHEL family was misclassified: %s %v", out, e)
	}
	if out, e := exec.Command("/bin/sh", "-n", script).CombinedOutput(); e != nil {
		t.Fatalf("%s %v", out, e)
	}
	for _, jail := range []string{"sshd", "3xui-login", "ddnezha-ssh-a;id", "ddnezha-ssh-$(id)"} {
		if e := exec.Command("/bin/sh", script, "status", jail).Run(); e == nil {
			t.Fatalf("foreign/injected jail accepted %s", jail)
		}
	}
}
func TestFB5SourceGeneration(t *testing.T) {
	p := initialPolicy()
	p.Enabled = true
	p.WhitelistOnly = true
	p.Allowlist = []string{"192.0.2.1", "2001:db8::1"}
	p.Ports = []uint16{2222}
	for _, backend := range []string{"nftables", "iptables"} {
		body, e := fail2banSources(p, []string{"198.51.100.0/24", "2001:db8:2::/48"}, "0123456789abcdef", backend)
		if e != nil {
			t.Fatal(e)
		}
		for _, bad := range []string{"flush ruleset", "-F INPUT", "-F FORWARD", "-t nat", "hook forward", "netns", "pppd", "reboot", "shutdown"} {
			if strings.Contains(body, bad) {
				t.Fatal("unsafe action", bad)
			}
		}
		path := filepath.Join(t.TempDir(), "sources.sh")
		_ = os.WriteFile(path, []byte(body), 0600)
		if out, e := exec.Command("/bin/sh", "-n", path).CombinedOutput(); e != nil {
			t.Fatalf("%s %v", out, e)
		}
		if !strings.Contains(body, "2222") || !strings.Contains(body, "192.0.2.1") {
			t.Fatal("policy omitted")
		}
	}
	if _, e := fail2banSources(p, []string{"192.0.2.1; reboot"}, "0123456789abcdef", "nftables"); e == nil {
		t.Fatal("source injection accepted")
	}
	if _, e := fail2banSources(p, nil, "x; reboot", "nftables"); e == nil {
		t.Fatal("name injection accepted")
	}
}
func privateFB5Fixture(t *testing.T, firewall string) (banGuard, string) {
	t.Helper()
	root, dir := t.TempDir(), t.TempDir()
	for _, d := range []string{"filter.d", "action.d", "jail.d"} {
		if e := os.MkdirAll(filepath.Join(root, d), 0700); e != nil {
			t.Fatal(e)
		}
	}
	for _, d := range []string{"filter.d", "action.d"} {
		if out, e := exec.Command("cp", "-a", "/etc/fail2ban/"+d+"/.", filepath.Join(root, d)).CombinedOutput(); e != nil {
			t.Fatalf("%v %s", e, out)
		}
	}
	write := func(name, body string) {
		t.Helper()
		if e := os.WriteFile(filepath.Join(root, name), []byte(body), 0600); e != nil {
			t.Fatal(e)
		}
	}
	write("fail2ban.conf", fmt.Sprintf("[Definition]\nsyslogsocket=auto\nallowipv6=auto\nloglevel=ERROR\nlogtarget=%s\nsocket=%s\npidfile=%s\ndbfile=%s\ndbpurgeage=86400\n", filepath.Join(root, "log"), filepath.Join(root, "socket"), filepath.Join(root, "pid"), filepath.Join(root, "db")))
	write("jail.conf", "[DEFAULT]\nbackend=polling\nusedns=no\nbantime=3600\nfindtime=600\nmaxretry=3\n")
	write("jail.local", "")
	source := filepath.Join(dir, "auth.log")
	if e := os.WriteFile(source, nil, 0600); e != nil {
		t.Fatal(e)
	}
	invoke := func(ctx context.Context, name string, args ...string) ([]byte, error) {
		if name == "/bin/sh" && len(args) == 2 && args[1] == "firewall" {
			return []byte(firewall + "\n"), nil
		}
		if name == "fail2ban-client" {
			args = append([]string{"-c", root, "-s", filepath.Join(root, "socket"), "-p", filepath.Join(root, "pid")}, args...)
		}
		ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
		defer cancel()
		return exec.CommandContext(ctx, name, args...).CombinedOutput()
	}
	if out, e := invoke(context.Background(), "fail2ban-client", "-x", "start"); e != nil {
		t.Fatalf("fixture start %s %v", out, e)
	}
	t.Cleanup(func() { _, _ = invoke(context.Background(), "fail2ban-client", "stop") })
	return banGuard{Name: "ddnezha-ssh-0123456789abcdef", Root: root, Dir: dir, Exec: invoke}, source
}
func TestSSHKernelFB5ParityAndIsolation(t *testing.T) {
	isolatedKernelTest(t)
	for _, backend := range []string{"nftables", "iptables"} {
		t.Run(backend, func(t *testing.T) {
			if _, e := exec.LookPath("fail2ban-client"); e != nil {
				t.Fatal(e)
			}
			for _, ip := range []string{"192.0.2.10", "192.0.2.11", "192.0.2.12", "2001:db8::10", "2001:db8::11"} {
				addLoopbackAddress(t, ip)
			}
			target, port := tcpFixture(t, "tcp4", "192.0.2.10:0")
			business, _ := tcpFixture(t, "tcp4", "192.0.2.10:0")
			movedTarget, movedPort := tcpFixture(t, "tcp4", "192.0.2.10:0")
			target6, port6 := tcpFixture(t, "tcp6", "[2001:db8::10]:0")
			// Existing routing/NAT/forwarding rules live in this isolated namespace.
			sentinel := "table inet business_keep { chain forward_keep { type filter hook forward priority 0; policy accept; }; }\ntable ip business_nat { chain post { type nat hook postrouting priority 100; policy accept; ip saddr 10.98.0.0/24 masquerade; }; }\n"
			c := exec.Command("nft", "-f", "-")
			c.Stdin = strings.NewReader(sentinel)
			if out, e := c.CombinedOutput(); e != nil {
				t.Fatalf("sentinel: %s %v", out, e)
			}
			t.Cleanup(func() {
				_ = exec.Command("nft", "delete", "table", "inet", "business_keep").Run()
				_ = exec.Command("nft", "delete", "table", "ip", "business_nat").Run()
			})
			before, e := exec.Command("nft", "list", "table", "ip", "business_nat").Output()
			if e != nil {
				t.Fatal(e)
			}
			g, source := privateFB5Fixture(t, backend)
			ctx := context.Background()
			p := initialPolicy()
			p.Enabled = true
			p.AutoBan = true
			p.MaxRetry = 3
			p.BanTime = -1
			p.Ports = []uint16{port, port6}
			p.Backend = "fail2ban"
			if e := g.configureFB5(ctx, p, nil, source); e != nil {
				b, _ := os.ReadFile(filepath.Join(g.Root, "log"))
				t.Fatalf("configure: %v %s", e, b)
			}
			expectFrom(t, "tcp4", target, "192.0.2.11", true)
			now := time.Now()
			entries := []BanEntry{{IP: "192.0.2.11", BannedAt: now.Add(-time.Minute).UnixMilli(), ExpiresAt: -1}, {IP: "2001:db8::11", BannedAt: now.UnixMilli(), ExpiresAt: now.Add(time.Minute).UnixMilli()}}
			if e := g.importFB5Bans(ctx, p, entries); e != nil {
				t.Fatal(e)
			}
			// Fail2ban applies ban commands asynchronously.
			time.Sleep(700 * time.Millisecond)
			expectFrom(t, "tcp4", target, "192.0.2.11", false)
			expectFrom(t, "tcp6", target6, "2001:db8::11", false)
			expectFrom(t, "tcp4", business, "192.0.2.11", true)
			read, e := g.readFB5Bans(ctx, time.Now())
			if e != nil || len(read) != 2 {
				t.Fatalf("ban metadata %+v %v", read, e)
			}
			page := readBanPage(ctx, BanQuery{ID: 7, Page: 1, PageSize: 10, Search: "192.0.2"}, Status{Backend: "fail2ban", AutoBanActive: true}, g, blacklistGuard{}, nativeState{}, time.Now())
			if page.Total != 1 || len(page.Items) != 1 || page.Items[0].ExpiresAt != -1 {
				t.Fatalf("paging %+v", page)
			}
			if e := g.unban(ctx, "192.0.2.11"); e != nil {
				t.Fatal(e)
			}
			time.Sleep(500 * time.Millisecond)
			expectFrom(t, "tcp4", target, "192.0.2.11", true)
			p.Allowlist = []string{"192.0.2.11", "2001:db8::11"}
			p.WhitelistOnly = true
			p.Revision++
			if e := g.configureFB5(ctx, p, []string{"192.0.2.0/24", "2001:db8::/32"}, source); e != nil {
				t.Fatal(e)
			}
			time.Sleep(500 * time.Millisecond)
			expectFrom(t, "tcp4", target, "192.0.2.11", true)
			expectFrom(t, "tcp6", target6, "2001:db8::11", true)
			expectFrom(t, "tcp4", target, "192.0.2.12", false)
			expectFrom(t, "tcp4", business, "192.0.2.12", true)
			p.WhitelistOnly = false
			p.Revision++
			if e := g.configureFB5(ctx, p, nil, source); e != nil {
				t.Fatal(e)
			}
			expectFrom(t, "tcp4", target, "192.0.2.12", true)
			// Shared validated events: other ports, unknown ports and successes
			// must never contribute to the Fail2ban counter.
			good := Event{ID: "one", Time: time.Now().UnixMilli(), SourceIP: "192.0.2.12", Port: port}
			ignored := []Event{good, good}
			ignored[0].Port = 0
			ignored[1].Success = true
			if e := g.publishFB5Events(p, ignored, time.Now()); e != nil {
				t.Fatal(e)
			}
			for i := 0; i < 3; i++ {
				event := good
				event.ID = fmt.Sprint(i)
				if e := g.publishFB5Events(p, []Event{event, event}, time.Now()); e != nil {
					t.Fatal(e)
				}
			}
			deadline := time.Now().Add(8 * time.Second)
			banned := false
			for time.Now().Before(deadline) {
				entries, e := g.readFB5Bans(ctx, time.Now())
				if e != nil {
					t.Fatal(e)
				}
				for _, v := range entries {
					if v.IP == "192.0.2.12" {
						banned = true
					}
				}
				if banned {
					break
				}
				time.Sleep(200 * time.Millisecond)
			}
			if !banned {
				log, _ := os.ReadFile(filepath.Join(g.Root, "log"))
				t.Fatalf("failures not banned: %s", log)
			}
			time.Sleep(500 * time.Millisecond)
			expectFrom(t, "tcp4", target, "192.0.2.12", false)
			expectFrom(t, "tcp4", business, "192.0.2.12", true)

			// Parameter edits move only the selected SSH protection.
			oldPorts := p.Ports
			p.Ports = []uint16{movedPort}
			p.Revision++
			if e := g.configureFB5(ctx, p, nil, source); e != nil {
				t.Fatal(e)
			}
			entries, e = g.readFB5RawBans(ctx, time.Now())
			if e != nil {
				t.Fatal(e)
			}
			if e = g.verifyFB5Bans(ctx, p, entries); e != nil {
				t.Fatal(e)
			}
			expectFrom(t, "tcp4", target, "192.0.2.12", true)
			expectFrom(t, "tcp4", movedTarget, "192.0.2.12", false)
			expectFrom(t, "tcp4", business, "192.0.2.12", true)
			p.Ports = oldPorts
			p.Revision++
			// Turning off automatic bans leaves manual rules available.
			p.AutoBan = false
			p.Allowlist = nil
			if e := g.configureFB5(ctx, p, []string{"192.0.2.11/32"}, source); e != nil {
				t.Fatal(e)
			}
			expectFrom(t, "tcp4", target, "192.0.2.12", true)
			expectFrom(t, "tcp4", target, "192.0.2.11", false)
			expectFrom(t, "tcp4", business, "192.0.2.11", true)
			beforeConfig, _ := os.ReadFile(g.fb5Path())
			failed := g
			actualExec := g.Exec
			failed.Exec = func(c context.Context, name string, args ...string) ([]byte, error) {
				if name == "fail2ban-client" && len(args) == 1 && args[0] == "-t" {
					return nil, fmt.Errorf("invalid fixture")
				}
				return actualExec(c, name, args...)
			}
			changed := p
			changed.Ports = []uint16{movedPort}
			if e := failed.configureFB5(ctx, changed, []string{"192.0.2.11/32"}, source); e == nil {
				t.Fatal("invalid apply accepted")
			}
			afterConfig, _ := os.ReadFile(g.fb5Path())
			if string(beforeConfig) != string(afterConfig) {
				t.Fatal("config rollback failed")
			}
			expectFrom(t, "tcp4", target, "192.0.2.11", false)
			if e := g.disableFB5(ctx); e != nil {
				t.Fatal(e)
			}
			expectFrom(t, "tcp4", target, "192.0.2.12", true)
			after, e := exec.Command("nft", "list", "table", "ip", "business_nat").Output()
			if e != nil || string(before) != string(after) {
				t.Fatalf("business NAT changed: %v", e)
			}
			if e := exec.Command("nft", "list", "table", "inet", "business_keep").Run(); e != nil {
				t.Fatal("forwarding rules removed")
			}
		})
	}
}

func TestFB5EventValidationAndRetry(t *testing.T) {
	g := banGuard{Dir: t.TempDir()}
	p := initialPolicy()
	p.Enabled = true
	p.AutoBan = true
	p.Ports = []uint16{2222}
	p.Allowlist = []string{"198.51.100.0/24"}
	now := time.Now()
	good := Event{ID: "test", Time: now.UnixMilli(), SourceIP: "192.0.2.1", Port: 2222}
	for _, change := range []func(*Event){
		func(e *Event) { e.Port = 0 }, func(e *Event) { e.Port = 22 }, func(e *Event) { e.Success = true },
		func(e *Event) { e.SourceIP = "198.51.100.1" }, func(e *Event) { e.SourceIP = "192.0.2.1; reboot" },
		func(e *Event) { e.Time = now.Add(-time.Hour).UnixMilli() },
	} {
		e := good
		change(&e)
		if fb5EventLine(p, e, now) != "" {
			t.Fatal("unprotected event published", e)
		}
	}
	for i := 0; i < 3; i++ {
		if e := g.publishFB5Events(p, []Event{good, good}, now); e != nil {
			t.Fatal(e)
		}
	}
	raw, e := os.ReadFile(g.fb5EventPath())
	if e != nil {
		t.Fatal(e)
	}
	if strings.Count(string(raw), "DDNEZHA-SSH") != 1 {
		t.Fatal("retry duplicated failure")
	}
	if strings.Contains(string(raw), "username") {
		t.Fatal("private fields included")
	}
	// A process restart reconstructs the writer and retains disk-based dedup.
	again := banGuard{Dir: g.Dir}
	if e := again.publishFB5Events(p, []Event{good}, now); e != nil {
		t.Fatal(e)
	}
	after, _ := os.ReadFile(g.fb5EventPath())
	if string(after) != string(raw) {
		t.Fatal("restart duplicated event")
	}

	next := good
	next.ID = "next"
	next.SourceIP = "192.0.2.2"
	f, e := os.OpenFile(g.fb5EventPath(), os.O_APPEND|os.O_WRONLY, 0600)
	if e != nil {
		t.Fatal(e)
	}
	f.WriteString(strings.TrimSuffix(fb5EventLine(p, next, now), "\n"))
	f.Close()
	if e := g.publishFB5Events(p, []Event{next}, now); e != nil {
		t.Fatal(e)
	}
	repaired, _ := os.ReadFile(g.fb5EventPath())
	if strings.Count(string(repaired), "DDNEZHA-SSH") != 2 || !strings.Contains(string(repaired), fb5EventLine(p, next, now)) {
		t.Fatal("partial write was not repaired")
	}
	target := filepath.Join(t.TempDir(), "sentinel")
	os.WriteFile(target, []byte("keep"), 0600)
	os.Remove(g.fb5EventPath())
	os.Symlink(target, g.fb5EventPath())
	if e := g.publishFB5Events(p, []Event{good}, now); e == nil {
		t.Fatal("symlink accepted")
	}
	b, _ := os.ReadFile(target)
	if string(b) != "keep" {
		t.Fatal("unrelated file changed")
	}
}
func TestFB5StartupDoesNotActivateOtherJails(t *testing.T) {
	if e := validateFB5Start("['add', 'sshd', 'systemd']"); e == nil {
		t.Fatal("foreign jail accepted")
	}
	if e := validateFB5Start("['add', '3xui-login', 'auto']"); e == nil {
		t.Fatal("XUI jail accepted")
	}
	if e := validateFB5Start("['add', 'ddnezha-ssh-0123456789abcdef', 'polling']"); e != nil {
		t.Fatal(e)
	}
	i := fail2banInstaller{started: true, done: false}
	if e := i.ensure(context.Background(), banGuard{}, 1); e == nil {
		t.Fatal("in-progress installation ignored")
	}
}

func TestFB5CacheInvalidationAndBoundaries(t *testing.T) {
	calls := 0
	g := banGuard{Dir: t.TempDir(), Exec: func(context.Context, string, ...string) ([]byte, error) {
		calls++
		return []byte("192.0.2.1  2026-11-12 00:00:00 + -1 = permanent\n"), nil
	}}
	now := time.Now()
	a, e := g.readFB5Bans(context.Background(), now)
	if e != nil {
		t.Fatal(e)
	}
	if len(a) != 1 {
		t.Fatal(a)
	}
	a[0].IP = "203.0.113.1"
	b, e := g.readFB5Bans(context.Background(), now)
	if e != nil {
		t.Fatal(e)
	}
	if calls != 1 || b[0].IP != "192.0.2.1" {
		t.Fatal("cache leaked or reread")
	}
	g.invalidateFB5Cache()
	_, e = g.readFB5Bans(context.Background(), now)
	if e != nil {
		t.Fatal(e)
	}
	if calls != 2 {
		t.Fatal("cache was not invalidated")
	}
}
func TestFB5OtherInstancePorts(t *testing.T) {
	root := t.TempDir()
	os.Mkdir(filepath.Join(root, "jail.d"), 0700)
	path := filepath.Join(root, "jail.d", "ddnezha-ssh-1111111111111111.local")
	os.WriteFile(path, []byte(ownedHeader+"[ddnezha-ssh-1111111111111111]\nenabled = true\nport = 22, 2222\n"), 0600)
	g := banGuard{Root: root, Name: "ddnezha-ssh-2222222222222222"}
	p := initialPolicy()
	p.Enabled = true
	if e := g.checkFB5Ports(p); e == nil {
		t.Fatal("conflicting ports accepted")
	}
	p.Ports = []uint16{2223}
	if e := g.checkFB5Ports(p); e != nil {
		t.Fatal(e)
	}
}

func BenchmarkFB5Source2000(b *testing.B) {
	p := initialPolicy()
	p.Enabled = true
	p.WhitelistOnly = true
	p.Allowlist = []string{"192.0.2.1"}
	for i := uint16(1); i <= 32; i++ {
		p.Ports = append(p.Ports, i+1000)
	}
	p.Ports = p.Ports[1:]
	prefixes := make([]string, 2000)
	for i := range prefixes {
		prefixes[i] = fmt.Sprintf("198.18.%d.%d/32", i/256, i%256)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, e := fail2banSources(p, prefixes, "0123456789abcdef", "iptables"); e != nil {
			b.Fatal(e)
		}
	}
}
func BenchmarkSSHBanPage10000(b *testing.B) {
	entries := make([]BanEntry, 10000)
	now := time.Now()
	for i := range entries {
		entries[i] = BanEntry{IP: fmt.Sprintf("198.18.%d.%d", i/256, i%256), BannedAt: now.UnixMilli(), ExpiresAt: -1}
	}
	q := BanQuery{ID: 1, Page: 50, PageSize: 100}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		page := paginateBans(entries, q, now)
		if len(page.Items) != 100 {
			b.Fatal("invalid page")
		}
	}
}
