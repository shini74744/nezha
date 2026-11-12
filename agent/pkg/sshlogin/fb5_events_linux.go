package sshlogin

import (
	"crypto/sha256"
	"fmt"
	"io"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/sys/unix"
)

// Fail2ban counts only events whose destination SSH port the Agent has verified.
// This shares native mode's OpenSSH/Dropbear parsing and never forwards passwords,
// usernames or arbitrary log text into a Fail2ban regex or shell action.
func fb5EventLine(p Policy, e Event, now time.Time) string {
	if !p.Protected(e) || e.Time < now.Add(-time.Duration(p.FindTime)*time.Second).UnixMilli() || e.Time > now.Add(5*time.Minute).UnixMilli() {
		return ""
	}
	ip, err := netip.ParseAddr(e.SourceIP)
	if err != nil {
		return ""
	}
	id := fmt.Sprintf("%x", sha256.Sum256([]byte(fmt.Sprintf("%s/%d/%s/%d", e.ID, e.Time, ip.Unmap(), e.Port))))
	return fmt.Sprintf("%d DDNEZHA-SSH port=%d ip=%s id=%s\n", e.Time/1000, e.Port, ip.Unmap(), id)
}
func (g *banGuard) fb5EventPath() string { return filepath.Join(g.Dir, "fail2ban-events.log") }
func (g *banGuard) ensureFB5EventLog() error {
	if err := privateDir(g.Dir); err != nil {
		return err
	}
	fd, err := unix.Open(g.fb5EventPath(), unix.O_CREAT|unix.O_WRONLY|unix.O_APPEND|unix.O_NOFOLLOW, 0600)
	if err != nil {
		return err
	}
	f := os.NewFile(uintptr(fd), g.fb5EventPath())
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return err
	}
	if !st.Mode().IsRegular() {
		return fmt.Errorf("SSH 事件文件无效")
	}
	return nil
}
func fb5LogTail(path string) (string, error) {
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_NOFOLLOW, 0)
	if os.IsNotExist(err) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	f := os.NewFile(uintptr(fd), path)
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return "", err
	}
	if !st.Mode().IsRegular() {
		return "", fmt.Errorf("SSH 事件文件无效")
	}
	if _, err = f.Seek(max(0, st.Size()-(1<<20)), io.SeekStart); err != nil {
		return "", err
	}
	b, err := io.ReadAll(io.LimitReader(f, 1<<20))
	return string(b), err
}
func (g *banGuard) publishFB5Events(p Policy, events []Event, now time.Time) error {
	if len(events) == 0 {
		return nil
	}
	if err := g.ensureFB5EventLog(); err != nil {
		return err
	}
	path := g.fb5EventPath()
	tail, err := fb5LogTail(path)
	if err != nil {
		return err
	}
	prior, err := fb5LogTail(path + ".1")
	if err != nil {
		return err
	}
	// Index the bounded tails once; rescanning megabytes for each failed login
	// makes large batches unnecessarily expensive during an SSH attack.
	seen := make(map[string]struct{})
	for _, text := range []string{tail, prior} {
		end := strings.LastIndexByte(text, '\n')
		if end < 0 {
			continue
		}
		for line := range strings.SplitSeq(text[:end], "\n") {
			if line != "" {
				seen[line] = struct{}{}
			}
		}
	}
	var out strings.Builder
	for _, event := range events {
		line := fb5EventLine(p, event, now)
		if line == "" {
			continue
		}
		key := strings.TrimSuffix(line, "\n")
		if _, duplicate := seen[key]; duplicate {
			continue
		}
		out.WriteString(line)
		seen[key] = struct{}{}
	}
	if out.Len() == 0 {
		fd, e := unix.Open(path, unix.O_WRONLY|unix.O_NOFOLLOW, 0)
		if e != nil {
			return e
		}
		f := os.NewFile(uintptr(fd), path)
		defer f.Close()
		return f.Sync()
	}
	// Two bounded files; pending batches are <= 1000 events and fit the dedup tail.
	st, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if st.Size() > 8<<20 {
		if err = os.Rename(path, path+".1"); err != nil {
			return err
		}
	}
	fd, err := unix.Open(path, unix.O_CREAT|unix.O_WRONLY|unix.O_APPEND|unix.O_NOFOLLOW, 0600)
	if err != nil {
		return err
	}
	f := os.NewFile(uintptr(fd), path)
	// Repair only an interrupted final line in this private event file.
	current, readErr := fb5LogTail(path)
	if readErr != nil {
		f.Close()
		return readErr
	}
	if len(current) > 0 && !strings.HasSuffix(current, "\n") {
		st, e := f.Stat()
		if e != nil {
			f.Close()
			return e
		}
		fragment := len(current) - strings.LastIndexByte(current, '\n') - 1
		if e = f.Truncate(st.Size() - int64(fragment)); e != nil {
			f.Close()
			return e
		}
	}
	_, err = f.WriteString(out.String())
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	return closeErr
}
