package sshlogin

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSSHKernelRealOpenSSHAuthentication(t *testing.T) {
	isolatedKernelTest(t)
	for _, tool := range []string{"sshd", "ssh", "ssh-keygen"} {
		if _, e := exec.LookPath(tool); e != nil {
			t.Skip(tool + " fixture unavailable")
		}
	}
	addLoopbackAddress(t, "192.0.2.10")
	addLoopbackAddress(t, "192.0.2.11")
	dir := t.TempDir()
	for _, name := range []string{"host", "good", "bad"} {
		out, e := exec.Command("ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", filepath.Join(dir, name)).CombinedOutput()
		if e != nil {
			t.Fatalf("temporary key generation: %v %s", e, out)
		}
	}
	listener, e := net.Listen("tcp4", "192.0.2.10:0")
	if e != nil {
		t.Fatal(e)
	}
	port := uint16(listener.Addr().(*net.TCPAddr).Port)
	listener.Close()
	cfg := fmt.Sprintf("ListenAddress 192.0.2.10\nPort %d\nHostKey %s\nPidFile %s\nAuthorizedKeysFile %s\nStrictModes no\nUsePAM no\nPermitRootLogin yes\nPubkeyAuthentication yes\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nAuthenticationMethods publickey\nLogLevel VERBOSE\n", port, filepath.Join(dir, "host"), filepath.Join(dir, "pid"), filepath.Join(dir, "good.pub"))
	configPath, logPath := filepath.Join(dir, "sshd_config"), filepath.Join(dir, "sshd.log")
	if e = os.WriteFile(configPath, []byte(cfg), 0600); e != nil {
		t.Fatal(e)
	}
	path, _ := exec.LookPath("sshd")
	daemon := exec.Command(path, "-D", "-f", configPath, "-E", logPath)
	if e = daemon.Start(); e != nil {
		t.Fatal(e)
	}
	defer func() { _ = daemon.Process.Kill(); _ = daemon.Wait() }()
	for i := 0; i < 50; i++ {
		c, e := net.DialTimeout("tcp4", fmt.Sprintf("192.0.2.10:%d", port), 50*time.Millisecond)
		if e == nil {
			c.Close()
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	invoke := func(key string) error {
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		defer cancel()
		return exec.CommandContext(ctx, "ssh", "-F", "/dev/null", "-i", filepath.Join(dir, key), "-p", fmt.Sprint(port), "-b", "192.0.2.11", "-o", "UserKnownHostsFile="+filepath.Join(dir, "known_hosts"), "-o", "StrictHostKeyChecking=no", "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "ConnectTimeout=2", "root@192.0.2.10", "true").Run()
	}
	if e = invoke("good"); e != nil {
		b, _ := os.ReadFile(logPath)
		t.Fatalf("isolated successful login: %v\n%s", e, b)
	}
	for i := 0; i < 2; i++ {
		if e = invoke("bad"); e == nil {
			t.Fatal("invalid key authenticated")
		}
	}
	raw, e := os.ReadFile(logPath)
	if e != nil {
		t.Fatal(e)
	}
	ports, peers := sockets(context.Background())
	events := []Event{}
	now := time.Now()
	for _, line := range strings.Split(string(raw), "\n") {
		if ev, ok := Parse(strings.TrimSpace(line), now); ok {
			events = append(events, ev)
		}
	}
	resolvePorts(events, ports, peers, now.Add(-time.Minute))
	p := initialPolicy()
	p.Enabled = true
	p.AutoBan = true
	p.Ports = []uint16{port}
	p.MaxRetry = 2
	p.BanTime = 60
	state := nativeState{}
	success, failure := 0, 0
	for _, ev := range events {
		if ev.Port != port {
			t.Fatalf("wrong server port: %+v ports=%v", ev, ports)
		}
		if ev.Success {
			success++
		} else {
			failure++
		}
		if e = state.observe(p, ev, now); e != nil {
			t.Fatal(e)
		}
	}
	if success != 1 || failure != 2 || len(state.Bans) != 1 {
		t.Fatalf("real log result success=%d failure=%d bans=%v logs=%s", success, failure, state.Bans, raw)
	}
	g := blacklistGuard{Name: "ddnz_ssh_cccccccccccccccc"}
	if e = g.apply(context.Background(), p, nil, state.active(p)); e != nil {
		t.Fatal(e)
	}
	expectFrom(t, "tcp4", fmt.Sprintf("192.0.2.10:%d", port), "192.0.2.11", false)
	if e = state.unban("192.0.2.11"); e != nil {
		t.Fatal(e)
	}
	if e = g.apply(context.Background(), p, nil, state.active(p)); e != nil {
		t.Fatal(e)
	}
	if e = invoke("good"); e != nil {
		t.Fatal("manual unban did not restore SSH", e)
	}
	p.Enabled = false
	if e = g.apply(context.Background(), p, nil, nil); e != nil {
		t.Fatal(e)
	}
	t.Log("PASS: real OpenSSH success/failure logs, destination port detection, failure threshold, kernel block, manual unban and successful login")
}
