package sshlogin

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/netip"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type cursor struct {
	Source   string
	Offset   int64
	Inode    uint64
	Journal  string
	Started  bool
	SkipLine bool
}
type collector struct{ Cursor cursor }

var trustedFileLine = regexp.MustCompile(`^(.*?)\s(?:sshd(?:-session|-auth)?|dropbear)\[([0-9]+)\]: (.*)$`)

func run(ctx context.Context, name string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.WaitDelay = time.Second
	out := &boundedBuffer{max: 8 << 20}
	cmd.Stdout = out
	cmd.Stderr = io.Discard
	err := cmd.Run()
	return out.Bytes(), err
}

type boundedBuffer struct {
	bytes.Buffer
	max int
}

func (b *boundedBuffer) Write(p []byte) (int, error) {
	if len(p) > b.max-b.Len() {
		return 0, fmt.Errorf("output limit")
	}
	return b.Buffer.Write(p)
}
func inode(f os.FileInfo) uint64 {
	if st, ok := f.Sys().(*syscall.Stat_t); ok {
		return st.Ino
	}
	return 0
}
func (c *collector) initialize(ctx context.Context) error {
	for _, p := range []string{"/var/log/auth.log", "/var/log/secure"} {
		f, err := os.Open(p)
		if err != nil {
			continue
		}
		st, err := f.Stat()
		f.Close()
		if err == nil && st.Mode().IsRegular() {
			c.Cursor = cursor{Source: p, Offset: st.Size(), Inode: inode(st), Started: true}
			return nil
		}
	}
	out, err := run(ctx, "journalctl", "--no-pager", "-o", "json", "-n", "1", "_COMM=sshd", "+", "_COMM=sshd-session", "+", "_COMM=sshd-auth", "+", "_COMM=dropbear")
	if err != nil {
		return fmt.Errorf("无法读取 SSH 日志")
	}
	c.Cursor = cursor{Source: "journal", Started: true}
	for _, line := range bytes.Split(out, []byte("\n")) {
		var item map[string]json.RawMessage
		if json.Unmarshal(line, &item) == nil {
			_ = json.Unmarshal(item["__CURSOR"], &c.Cursor.Journal)
		}
	}
	// An empty journal starts at now, never at the beginning of stored history.
	if c.Cursor.Journal == "" {
		c.Cursor.Offset = time.Now().UnixMicro()
	}
	return nil
}
func parseFileTime(prefix string, now time.Time) time.Time {
	fields := strings.Fields(prefix)
	if len(fields) == 0 {
		return now
	}
	if t, e := time.Parse(time.RFC3339Nano, fields[0]); e == nil {
		return t
	}
	if len(fields) >= 3 {
		raw := fmt.Sprintf("%d %s", now.Year(), strings.Join(fields[:3], " "))
		if t, e := time.ParseInLocation("2006 Jan 2 15:04:05", raw, time.Local); e == nil {
			if t.After(now.Add(24 * time.Hour)) {
				t = t.AddDate(-1, 0, 0)
			}
			return t
		}
	}
	return now
}
func eventID(source string) string {
	sum := sha256.Sum256([]byte(source))
	return hex.EncodeToString(sum[:])
}
func (c *collector) poll(ctx context.Context, limit int) ([]Event, error) {
	if limit <= 0 {
		return nil, nil
	}
	if !c.Cursor.Started {
		return nil, c.initialize(ctx)
	}
	if c.Cursor.Source == "journal" {
		return c.journal(ctx, limit)
	}
	return c.file(limit)
}
func (c *collector) file(limit int) ([]Event, error) {
	path := c.Cursor.Source
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("无法读取 SSH 日志")
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() {
		return nil, fmt.Errorf("SSH 日志不可用")
	}
	if inode(st) != c.Cursor.Inode {
		// Drain an uncompressed rotation with the previous inode before switching.
		matches, _ := filepath.Glob(path + "*")
		for _, old := range matches {
			info, e := os.Stat(old)
			if e == nil && inode(info) == c.Cursor.Inode && info.Size() > c.Cursor.Offset {
				current := c.Cursor.Source
				c.Cursor.Source = old
				events, e := c.file(limit)
				c.Cursor.Source = current
				return events, e
			}
		}
		c.Cursor.Inode = inode(st)
		c.Cursor.Offset = 0
	}
	if st.Size() < c.Cursor.Offset {
		c.Cursor.Offset = 0
	}
	if _, err = f.Seek(c.Cursor.Offset, io.SeekStart); err != nil {
		return nil, err
	}
	reader := bufio.NewReaderSize(f, 65536)
	events := []Event{}
	consumed := 0
	for consumed < 2<<20 && len(events) < limit {
		chunk, e := reader.ReadSlice('\n')
		consumed += len(chunk)
		if e == bufio.ErrBufferFull {
			c.Cursor.Offset += int64(len(chunk))
			c.Cursor.SkipLine = true
			continue
		}
		if e != nil {
			if c.Cursor.SkipLine {
				c.Cursor.Offset += int64(len(chunk))
			}
			break
		}
		offset := c.Cursor.Offset
		c.Cursor.Offset += int64(len(chunk))
		if c.Cursor.SkipLine {
			c.Cursor.SkipLine = false
			continue
		}
		line := string(chunk)
		m := trustedFileLine.FindStringSubmatch(strings.TrimSuffix(line, "\n"))
		if m == nil {
			continue
		}
		event, ok := Parse(m[3], parseFileTime(m[1], time.Now()))
		if !ok {
			continue
		}
		event.ID = eventID(fmt.Sprintf("%s/%d/%d/%s", path, c.Cursor.Inode, offset, line))
		events = append(events, event)
	}
	return events, nil
}
func (c *collector) journal(ctx context.Context, limit int) ([]Event, error) {
	args := []string{"--no-pager", "-o", "json", "_COMM=sshd", "+", "_COMM=sshd-session", "+", "_COMM=sshd-auth", "+", "_COMM=dropbear"}
	if c.Cursor.Journal != "" {
		args = append(args, "--after-cursor="+c.Cursor.Journal)
	} else {
		args = append(args, "--since=@"+strconv.FormatFloat(float64(c.Cursor.Offset)/1e6, 'f', 6, 64))
	}
	events, err := c.readJournal(ctx, args, limit)
	if err != nil && c.Cursor.Journal != "" && c.Cursor.Offset > 0 {
		// A vacuum can remove the cursor. Resume from the last consumed timestamp,
		// never from the beginning and never silently skip forward to now.
		args = args[:len(args)-1]
		args = append(args, "--since=@"+strconv.FormatFloat(float64(c.Cursor.Offset+1)/1e6, 'f', 6, 64))
		events, err = c.readJournal(ctx, args, limit)
	}
	if err != nil {
		return nil, fmt.Errorf("无法读取 SSH 日志，请检查本机日志服务")
	}
	return events, nil
}
func (c *collector) readJournal(ctx context.Context, args []string, limit int) ([]Event, error) {
	ctx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "journalctl", args...)
	cmd.WaitDelay = time.Second
	pipe, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err = cmd.Start(); err != nil {
		return nil, err
	}
	scan := bufio.NewScanner(pipe)
	scan.Buffer(make([]byte, 4096), 131072)
	events := []Event{}
	lines := 0
	bounded := false
	before := c.Cursor
	for scan.Scan() {
		lines++
		var item struct {
			Cursor  string `json:"__CURSOR"`
			Time    string `json:"__REALTIME_TIMESTAMP"`
			Message string `json:"MESSAGE"`
		}
		if json.Unmarshal(scan.Bytes(), &item) == nil && item.Cursor != "" {
			ts, _ := strconv.ParseInt(item.Time, 10, 64)
			if ts > 0 {
				c.Cursor.Journal = item.Cursor
				c.Cursor.Offset = ts
				if e, ok := Parse(item.Message, time.UnixMicro(ts)); ok {
					e.ID = eventID(item.Cursor)
					events = append(events, e)
				}
			}
		}
		if len(events) >= limit || lines >= 4096 {
			bounded = true
			cancel()
			break
		}
	}
	scanErr := scan.Err()
	waitErr := cmd.Wait()
	if bounded {
		return events, nil
	}
	if scanErr != nil || waitErr != nil {
		c.Cursor = before
		if scanErr != nil {
			return nil, scanErr
		}
		return nil, waitErr
	}
	return events, nil
}

// ss identifies destination ports from sockets rather than the "port" in auth logs.
func sockets(ctx context.Context) ([]uint16, map[string]uint16) {
	ports := []uint16{}
	peers := map[string]uint16{}
	out, err := run(ctx, "ss", "-H", "-ntap")
	if err != nil {
		return ports, peers
	}
	seen := map[uint16]bool{}
	for _, line := range strings.Split(string(out), "\n") {
		f := strings.Fields(line)
		if len(f) < 6 {
			continue
		}
		owned := strings.Contains(line, "\"sshd") || strings.Contains(line, "\"dropbear")
		local := f[3]
		i := strings.LastIndex(local, ":")
		if i < 0 {
			continue
		}
		n, e := strconv.ParseUint(local[i+1:], 10, 16)
		if e != nil || n == 0 {
			continue
		}
		if f[0] == "LISTEN" && owned && !seen[uint16(n)] {
			ports = append(ports, uint16(n))
			seen[uint16(n)] = true
		}
		if f[0] != "LISTEN" && owned {
			peer := f[4]
			j := strings.LastIndex(peer, ":")
			if j > 0 {
				if a, e := netip.ParseAddr(strings.Trim(peer[:j], "[]")); e == nil {
					peers[a.Unmap().String()+":"+peer[j+1:]] = uint16(n)
				}
			}
		}
	}
	return ports, peers
}
func resolvePorts(events []Event, ports []uint16, peers map[string]uint16, stableSince time.Time) {
	for i := range events {
		if p := peers[events[i].SourceIP+":"+fmt.Sprint(events[i].SourcePort)]; p > 0 {
			events[i].Port = p
		} else if len(ports) == 1 && events[i].Time >= stableSince.UnixMilli() && !stableSince.IsZero() && events[i].Time >= time.Now().Add(-15*time.Second).UnixMilli() {
			events[i].Port = ports[0]
		}
	}
}
