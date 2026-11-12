package sshlogin

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSSHAlpineSourcePriorityAndMissingLogs(t *testing.T) {
	dir := t.TempDir()
	auth, messages := filepath.Join(dir, "auth.log"), filepath.Join(dir, "messages")
	history := "old history\n"
	for _, path := range []string{auth, messages} {
		if err := os.WriteFile(path, []byte(history), 0600); err != nil {
			t.Fatal(err)
		}
	}
	unavailable := func(context.Context, string, ...string) ([]byte, error) {
		return nil, fmt.Errorf("journalctl unavailable")
	}
	t.Run("dedicated first", func(t *testing.T) {
		c := collector{}
		journal := func(context.Context, string, ...string) ([]byte, error) {
			t.Fatal("dedicated log should avoid journal")
			return nil, nil
		}
		if err := c.initializeSources(context.Background(), []string{auth}, []string{messages}, journal); err != nil {
			t.Fatal(err)
		}
		if c.Cursor.Source != auth || c.Cursor.Shared || c.Cursor.Offset != int64(len(history)) {
			t.Fatal(c.Cursor)
		}
	})
	t.Run("journal before shared file", func(t *testing.T) {
		c := collector{}
		journal := func(context.Context, string, ...string) ([]byte, error) {
			return []byte("{\"__CURSOR\":\"fixture\"}\n"), nil
		}
		if err := c.initializeSources(context.Background(), nil, []string{messages}, journal); err != nil {
			t.Fatal(err)
		}
		if c.Cursor.Source != "journal" || c.Cursor.Journal != "fixture" || c.Cursor.Shared {
			t.Fatal(c.Cursor)
		}
	})
	t.Run("busybox fallback no history replay", func(t *testing.T) {
		c := collector{}
		if err := c.initializeSources(context.Background(), nil, []string{messages}, unavailable); err != nil {
			t.Fatal(err)
		}
		if !c.Cursor.Shared || c.Cursor.Source != messages || c.Cursor.Offset != int64(len(history)) {
			t.Fatal(c.Cursor)
		}
		events, err := c.poll(context.Background(), 20)
		if err != nil || len(events) != 0 {
			t.Fatal("replayed history", err, events)
		}
	})
	t.Run("invalid files remain an error", func(t *testing.T) {
		c := collector{}
		if err := c.initializeSources(context.Background(), []string{dir}, []string{filepath.Join(dir, "missing"), dir}, unavailable); err == nil {
			t.Fatal("missing logs accepted")
		}
	})
}

func TestSSHAlpineMixedMessagesAndSilentPermanentBan(t *testing.T) {
	path := filepath.Join(t.TempDir(), "messages")
	if err := os.WriteFile(path, nil, 0600); err != nil {
		t.Fatal(err)
	}
	c := collector{}
	if !c.initializeFile(path, true) {
		t.Fatal("initialize")
	}
	now := time.Now()
	header := now.Format("Jan _2 15:04:05") + " alpine "
	fail := "Failed password for invalid user fixture from 192.0.2.10 port 50000 ssh2"
	lines := []string{
		header + "auth.info sshd[123]: " + fail,
		header + "authpriv.notice sshd-session[124]: " + fail,
		now.Format(time.RFC3339Nano) + " alpine sshd-auth[125]: " + fail,
		header + "auth.info sshd[126]: Accepted publickey for fixture from 192.0.2.11 port 50001 ssh2",
		header + "user.info app[9]: " + fail,
		header + "user.notice app[9]: untrusted sshd[123]: " + fail,
		header + "kern.warn kernel: sshd[123]: " + fail,
		"untrusted sshd[123]: " + fail,
		header + "auth.info notsshd[123]: " + fail,
	}
	if err := os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	events, err := c.file(100)
	if err != nil || len(events) != 4 {
		t.Fatalf("events=%+v err=%v", events, err)
	}
	resolvePorts(events, []uint16{22}, nil, now.Add(-time.Minute))
	p := initialPolicy()
	p.Enabled, p.AutoBan, p.Success, p.Failure = true, true, false, false
	p.Ports, p.MaxRetry, p.FindTime, p.BanTime = []uint16{22}, 3, 86400, -1
	state := nativeState{}
	for _, event := range events {
		if err := state.observe(p, event, now); err != nil {
			t.Fatal(err)
		}
	}
	if len(state.Bans) != 1 || state.Bans["192.0.2.10"] != -1 {
		t.Fatal("silent permanent ban failed", state.Bans)
	}
	for _, event := range events {
		if (event.Success && p.Success) || (!event.Success && p.Failure) {
			t.Fatal("notification should stay disabled")
		}
	}
}

func TestSSHAlpineRestartRotationAndPartialLine(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "messages")
	line := func(user string) string {
		return time.Now().Format("Jan _2 15:04:05") + " alpine auth.info sshd[123]: Failed password for " + user + " from 192.0.2.10 port 50000 ssh2\n"
	}
	appendText := func(text string) {
		t.Helper()
		f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0600)
		if err != nil {
			t.Fatal(err)
		}
		defer f.Close()
		if _, err = f.WriteString(text); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(path, []byte(line("history")), 0600); err != nil {
		t.Fatal(err)
	}
	c := collector{}
	if !c.initializeFile(path, true) {
		t.Fatal("initialize")
	}
	appendText(line("first"))
	first, err := c.file(10)
	if err != nil || len(first) != 1 || first[0].Username != "first" {
		t.Fatal(err, first)
	}
	raw, err := json.Marshal(c.Cursor)
	if err != nil {
		t.Fatal(err)
	}
	resumed := collector{}
	if err = json.Unmarshal(raw, &resumed.Cursor); err != nil {
		t.Fatal(err)
	}
	if !resumed.Cursor.Shared {
		t.Fatal("shared validation lost on restart")
	}
	events, err := resumed.file(10)
	if err != nil || len(events) != 0 {
		t.Fatal("restart replay", err, events)
	}
	appendText(strings.TrimSuffix(line("partial"), "\n"))
	events, err = resumed.file(10)
	if err != nil || len(events) != 0 {
		t.Fatal("partial consumed", err, events)
	}
	appendText("\n" + line("rotated"))
	if err = os.Rename(path, path+".0"); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, []byte(line("current")), 0600); err != nil {
		t.Fatal(err)
	}
	events, err = resumed.file(10)
	if err != nil || len(events) != 2 || events[0].Username != "partial" || events[1].Username != "rotated" {
		t.Fatal("old rotation tail lost", err, events)
	}
	events, err = resumed.file(10)
	if err != nil || len(events) != 1 || events[0].Username != "current" || !resumed.Cursor.Shared {
		t.Fatal("current rotation lost", err, events)
	}
	if err = os.WriteFile(path, nil, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = resumed.file(10); err != nil {
		t.Fatal(err)
	}
	appendText(line("truncated"))
	events, err = resumed.file(10)
	if err != nil || len(events) != 1 || events[0].Username != "truncated" {
		t.Fatal("copytruncate failed", err, events)
	}
}
