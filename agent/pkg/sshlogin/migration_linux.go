package sshlogin

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"golang.org/x/sys/unix"
	"net/netip"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type migrationSnapshot struct {
	BanStarts      map[string]int64
	Info           ExistingSSH
	Bans           map[string]int64
	Files          map[string]string
	CreatedAt      int64
	Complete       bool
	PolicyRevision uint64
	Paused         bool
}

var timedBanLine = regexp.MustCompile(`^(\S+)\s+(.+?)\s+\+\s+(-?\d+)\s+=\s+(.+)$`)

func parseTimedBans(raw string, now time.Time) (map[string]int64, error) {
	out := map[string]int64{}
	for _, line := range strings.Split(strings.TrimSpace(raw), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		match := timedBanLine.FindStringSubmatch(strings.TrimSpace(line))
		if match == nil {
			return nil, fmt.Errorf("无法确认原有封禁的剩余时长")
		}
		ip, e := netip.ParseAddr(match[1])
		if e != nil || ip.Zone() != "" {
			return nil, fmt.Errorf("原有封禁 IP 无效")
		}
		duration, e := strconv.ParseInt(match[3], 10, 64)
		if e != nil || duration < -1 || duration > 315360000 {
			return nil, fmt.Errorf("原有封禁时长无效")
		}
		until := int64(-1)
		if duration != -1 {
			at, e := time.ParseInLocation("2006-01-02 15:04:05", match[2], time.Local)
			if e != nil {
				return nil, fmt.Errorf("无法读取原有封禁时间")
			}
			until = at.Add(time.Duration(duration) * time.Second).UnixMilli()
			if until <= now.UnixMilli() {
				continue
			}
		}
		out[ip.Unmap().String()] = until
		if len(out) > 10000 {
			return nil, fmt.Errorf("原有封禁过多，迁移已停止")
		}
	}
	return out, nil
}
func (g *banGuard) migrationPath() string { return filepath.Join(g.Dir, "migration", "manifest.json") }
func (g *banGuard) migrationOverlay() string {
	return filepath.Join(g.Root, "jail.d", "zzzz-ddnezha-ssh-native.local")
}
func (g *banGuard) migrationHeader() string { return ownedHeader + "# instance: " + g.Name + "\n" }
func (g *banGuard) saveMigration(m *migrationSnapshot) error {
	b, e := json.MarshalIndent(m, "", "  ")
	if e != nil {
		return e
	}
	return atomicFile(g.migrationPath(), b)
}
func (g *banGuard) prepareMigration(ctx context.Context) (*migrationSnapshot, error) {
	dir := filepath.Dir(g.migrationPath())
	if raw, e := os.ReadFile(g.migrationPath()); e == nil {
		var m migrationSnapshot
		if len(raw) > 8<<20 || json.Unmarshal(raw, &m) != nil {
			return nil, fmt.Errorf("迁移备份无效")
		}
		for rel, hash := range m.Files {
			if filepath.IsAbs(rel) || strings.Contains(rel, "..") {
				return nil, fmt.Errorf("迁移备份路径无效")
			}
			b, e := os.ReadFile(filepath.Join(dir, rel))
			if e != nil || fmt.Sprintf("%x", sha256.Sum256(b)) != hash {
				return nil, fmt.Errorf("迁移备份校验失败")
			}
		}
		return &m, nil
	} else if !os.IsNotExist(e) {
		return nil, e
	}
	info := g.existing(ctx)
	if info == nil {
		return nil, nil
	}
	if len(info.Ports) == 0 || info.MaxRetry < 1 || info.FindTime < 1 || (info.BanTime < 1 && info.BanTime != -1) {
		return nil, fmt.Errorf("原有 SSH 参数未读取完整，尚未接管")
	}
	if e := privateDir(dir); e != nil {
		return nil, e
	}
	m := &migrationSnapshot{Info: *info, Files: map[string]string{}, Bans: map[string]int64{}, CreatedAt: time.Now().Unix()}
	paths := []string{filepath.Join(g.Root, "jail.conf"), filepath.Join(g.Root, "jail.local")}
	for _, glob := range []string{"jail.d/*.conf", "jail.d/*.local"} {
		files, _ := filepath.Glob(filepath.Join(g.Root, glob))
		paths = append(paths, files...)
	}
	if len(paths) > 256 {
		return nil, fmt.Errorf("原有配置文件过多，尚未接管")
	}
	for _, path := range paths {
		st, e := os.Lstat(path)
		if os.IsNotExist(e) {
			continue
		}
		if e != nil || !st.Mode().IsRegular() || st.Size() > 2<<20 {
			return nil, fmt.Errorf("原有配置无法安全备份")
		}
		rel, e := filepath.Rel(g.Root, path)
		if e != nil {
			return nil, e
		}
		b, e := os.ReadFile(path)
		if e != nil {
			return nil, e
		}
		target := filepath.Join(dir, "config", rel)
		if e = privateDir(filepath.Dir(target)); e != nil {
			return nil, e
		}
		if e = atomicFile(target, b); e != nil {
			return nil, e
		}
		verify, e := os.ReadFile(target)
		hash := sha256.Sum256(b)
		if e != nil || sha256.Sum256(verify) != hash {
			return nil, fmt.Errorf("原有配置备份校验失败")
		}
		m.Files[filepath.Join("config", rel)] = fmt.Sprintf("%x", hash)
	}
	if e := g.saveMigration(m); e != nil {
		return nil, e
	}
	return m, nil
}
func (g *banGuard) cutover(ctx context.Context, m *migrationSnapshot, apply func(*migrationSnapshot) error) error {
	if m == nil {
		return nil
	}
	lockPath := filepath.Join(g.Root, "jail.d", ".ddnezha-ssh.lock")
	fd, lockErr := unix.Open(lockPath, unix.O_CREAT|unix.O_RDWR|unix.O_NOFOLLOW, 0600)
	if lockErr != nil {
		return fmt.Errorf("无法锁定 SSH 迁移配置")
	}
	defer unix.Close(fd)
	if lockErr = unix.Flock(fd, unix.LOCK_EX|unix.LOCK_NB); lockErr != nil {
		return fmt.Errorf("另一操作正在迁移 SSH 防护")
	}
	defer unix.Flock(fd, unix.LOCK_UN)

	if m.Complete {
		if _, e := g.Exec(ctx, "fail2ban-client", "status", "sshd"); e == nil {
			return fmt.Errorf("原 SSH 防护被重新启用，请检查本机规则冲突")
		}
		return nil
	}
	overlay := g.migrationOverlay()
	old, e := os.ReadFile(overlay)
	if e == nil {
		st, statErr := os.Lstat(overlay)
		if statErr != nil || !st.Mode().IsRegular() || !strings.HasPrefix(string(old), g.migrationHeader()) {
			return fmt.Errorf("另一实例已管理 SSH 防护，尚未接管")
		}
	} else if !os.IsNotExist(e) {
		return e
	}
	_, runningErr := g.Exec(ctx, "fail2ban-client", "status", "sshd")
	if runningErr != nil {
		// Recover a crash after stopping the old jail but before writing the receipt.
		if e == nil && strings.HasPrefix(string(old), g.migrationHeader()) {
			if err := apply(m); err != nil {
				return err
			}
			m.Complete = true
			return g.saveMigration(m)
		}
		return fmt.Errorf("原 SSH 防护状态无法确认，尚未接管")
	}
	if m.Paused {
		if e = g.recoverPause(ctx, m); e != nil {
			return e
		}
	}
	m.Paused = true
	if e = g.saveMigration(m); e != nil {
		return e
	}
	if _, e = g.Exec(ctx, "fail2ban-client", "set", "sshd", "idle", "on"); e != nil {
		_ = g.recoverPause(context.WithoutCancel(ctx), m)
		return fmt.Errorf("无法暂存原 SSH 防护，尚未接管")
	}
	stopped := false
	defer func() {
		if !stopped {
			_ = g.recoverPause(context.WithoutCancel(ctx), m)
		}
	}()
	raw, e := g.Exec(ctx, "fail2ban-client", "get", "sshd", "banip", "--with-time")
	if e != nil {
		return fmt.Errorf("原有封禁无法完整读取，尚未接管")
	}
	bans, e := parseTimedBans(string(raw), time.Now())
	if e != nil {
		return e
	}
	m.Bans = bans
	m.BanStarts = parseTimedBanStarts(string(raw))
	if e = g.saveMigration(m); e != nil {
		return e
	}
	// The callback must durably save and verify the replacement kernel rules
	// before this function can disable the original SSH jail.
	if e = apply(m); e != nil {
		return e
	}
	if e = writeOwned(overlay, []byte(g.migrationHeader()+"[sshd]\nenabled = false\n")); e != nil {
		return e
	}
	rollback := func() {
		if old != nil {
			_ = writeOwned(overlay, old)
		} else {
			_ = os.Remove(overlay)
		}
	}
	if _, e = g.Exec(ctx, "fail2ban-client", "-t"); e != nil {
		rollback()
		return fmt.Errorf("原有配置检查失败，旧 SSH 防护保留")
	}
	dump, e := g.Exec(ctx, "fail2ban-client", "-d")
	if e != nil || strings.Contains(string(dump), "['add', 'sshd',") {
		rollback()
		return fmt.Errorf("无法确认旧 SSH 防护已停用，原配置保留")
	}
	if _, e = g.Exec(ctx, "fail2ban-client", "stop", "sshd"); e != nil {
		rollback()
		return fmt.Errorf("旧 SSH 防护尚未停止，迁移未完成")
	}
	stopped = true
	m.Paused = false
	m.Complete = true
	return g.saveMigration(m)
}

// The durable marker recovers an interrupted handover before normal monitoring.
func (g *banGuard) recoverPause(ctx context.Context, m *migrationSnapshot) error {
	if m == nil || !m.Paused {
		return nil
	}
	if _, e := g.Exec(ctx, "fail2ban-client", "status", "sshd"); e == nil {
		if _, e = g.Exec(ctx, "fail2ban-client", "set", "sshd", "idle", "off"); e != nil {
			return fmt.Errorf("原 SSH 防护恢复检测失败")
		}
	}
	m.Paused = false
	return g.saveMigration(m)
}
func effectivePolicy(p Policy, m *migrationSnapshot) Policy {
	if m != nil && m.PolicyRevision == p.Revision {
		p.Allowlist = mergeAllowed(p.Allowlist, m.Info.Allowlist)
	}
	return p
}

func (g *banGuard) prepareMigrationRecovery(ctx context.Context) (*migrationSnapshot, error) {
	// Read an existing receipt only; never create a migration merely on Agent start.
	if _, e := os.Stat(g.migrationPath()); os.IsNotExist(e) {
		return nil, nil
	}
	m, e := g.prepareMigration(ctx)
	if e != nil {
		return nil, e
	}
	if m != nil && m.Paused {
		fd, e := unix.Open(filepath.Join(g.Root, "jail.d", ".ddnezha-ssh.lock"), unix.O_CREAT|unix.O_RDWR|unix.O_NOFOLLOW, 0600)
		if e != nil {
			return nil, e
		}
		defer unix.Close(fd)
		if e = unix.Flock(fd, unix.LOCK_EX|unix.LOCK_NB); e != nil {
			return nil, e
		}
		defer unix.Flock(fd, unix.LOCK_UN)
		if e = g.recoverPause(ctx, m); e != nil {
			return nil, e
		}
	}
	return m, nil
}
