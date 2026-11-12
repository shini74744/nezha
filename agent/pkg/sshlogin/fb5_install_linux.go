package sshlogin

import (
	"context"
	"fmt"
	"github.com/nezhahq/agent/scripts/sshsecurity"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/sys/unix"
)

// Installation runs outside the collector loop. A failed revision is not retried
// indefinitely; saving settings again explicitly starts a new attempt.
type fail2banInstaller struct {
	mu            sync.Mutex
	revision      uint64
	started, done bool
	err           error
}

func (i *fail2banInstaller) ensure(ctx context.Context, g banGuard, revision uint64) error {
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.started && !i.done {
		return fmt.Errorf("正在安装 Fail2ban，原防护保持运行")
	}
	if i.started && i.revision == revision {
		return i.err
	}
	if _, e := exec.LookPath("fail2ban-client"); e == nil {
		return nil
	}
	i.started = true
	i.done = false
	i.revision = revision
	go func() {
		err := installFail2ban(ctx, g)
		i.mu.Lock()
		i.done = true
		i.err = err
		i.mu.Unlock()
	}()
	return fmt.Errorf("正在安装 Fail2ban，原防护保持运行")
}
func installFail2ban(ctx context.Context, g banGuard) error {
	if os.Geteuid() != 0 {
		return fmt.Errorf("安装 Fail2ban 需要管理员权限")
	}
	if e := privateDir(g.Dir); e != nil {
		return e
	}
	fd, e := unix.Open("/run/ddnezha-fail2ban-install.lock", unix.O_CREAT|unix.O_RDWR|unix.O_NOFOLLOW, 0600)
	if e != nil {
		return fmt.Errorf("无法锁定组件安装")
	}
	defer unix.Close(fd)
	if e = unix.Flock(fd, unix.LOCK_EX|unix.LOCK_NB); e != nil {
		return fmt.Errorf("其他实例正在安装 Fail2ban，请稍后重试")
	}
	defer unix.Flock(fd, unix.LOCK_UN)
	if _, e = exec.LookPath("fail2ban-client"); e == nil {
		return nil
	}

	if e := filepath.WalkDir(g.Root, func(path string, d os.DirEntry, err error) error {
		if os.IsNotExist(err) {
			return nil
		}
		if err != nil {
			return err
		}
		if d.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("发现原有 Fail2ban 配置链接，请先检查原有安装")
		}
		if d.IsDir() {
			return nil
		}
		if filepath.Ext(path) != ".local" && filepath.Ext(path) != ".conf" {
			return nil
		}
		st, e := os.Lstat(path)
		if e != nil {
			return e
		}
		if !st.Mode().IsRegular() {
			return fmt.Errorf("发现原有 Fail2ban 配置，请先恢复原有安装")
		}
		data, e := os.ReadFile(path)
		if e != nil {
			return e
		}
		if !strings.HasPrefix(string(data), ownedHeader) {
			return fmt.Errorf("发现原有 Fail2ban 配置，请先恢复原有安装")
		}
		return nil
	}); e != nil {
		return e
	}
	// Package post-install scripts may start the distribution's default sshd jail.
	// Disable that default before installing; never edit existing user files.
	if e = privateDir(filepath.Join(g.Root, "jail.d")); e != nil {
		return e
	}
	safe := filepath.Join(g.Root, "jail.d", "zzzzzz-ddnezha-install.local")
	if e = writeOwned(safe, []byte(ownedHeader+"[sshd]\nenabled = false\n")); e != nil {
		return e
	}
	ctx, cancel := context.WithTimeout(ctx, 8*time.Minute)
	defer cancel()
	script := filepath.Join(g.Dir, "fail2ban-ssh.sh")
	if e = writeOwned(script, append([]byte(ownedHeader), sshsecurity.Script...)); e != nil {
		return e
	}
	c := exec.CommandContext(ctx, "/bin/sh", script, "install")
	c.WaitDelay = 2 * time.Second
	out := &boundedBuffer{max: 2 << 20}
	c.Stdout = out
	c.Stderr = out
	if e = c.Run(); e != nil {
		return fmt.Errorf("Fail2ban 安装失败，请检查软件源和系统支持后重新保存")
	}
	if _, e = exec.LookPath("fail2ban-client"); e != nil {
		return fmt.Errorf("Fail2ban 安装后未找到程序")
	}
	return nil
}
func (g *banGuard) startFail2ban(ctx context.Context) error {
	if _, e := g.Exec(ctx, "fail2ban-client", "ping"); e == nil {
		return nil
	}
	dump, err := g.Exec(ctx, "fail2ban-client", "-d")
	if err != nil {
		return fmt.Errorf("Fail2ban 配置检查失败，原防护保留")
	}
	if err = validateFB5Start(string(dump)); err != nil {
		return err
	}
	if _, e := g.Exec(ctx, "fail2ban-client", "-t"); e != nil {
		return fmt.Errorf("Fail2ban 配置检查失败，原防护保留")
	}
	if _, e := os.Stat("/run/systemd/system"); e == nil {
		if _, e = g.Exec(ctx, "systemctl", "start", "fail2ban"); e != nil {
			return fmt.Errorf("Fail2ban 启动失败")
		}
	} else if _, e := exec.LookPath("rc-service"); e == nil {
		if _, e = g.Exec(ctx, "rc-service", "fail2ban", "start"); e != nil {
			return fmt.Errorf("Fail2ban 启动失败")
		}
	} else {
		return fmt.Errorf("当前系统暂不支持自动启动 Fail2ban")
	}
	if _, e := g.Exec(ctx, "fail2ban-client", "ping"); e != nil {
		return fmt.Errorf("Fail2ban 暂未就绪")
	}
	return nil
}

// Starting a stopped shared daemon would also start every enabled third-party
// jail. Refuse that side effect; a running shared daemon is reused without restart.
func validateFB5Start(dump string) error {
	for _, line := range strings.Split(dump, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "['add', ") {
			continue
		}
		parts := strings.Split(line, "'")
		if len(parts) < 4 || !strings.HasPrefix(parts[3], "ddnezha-ssh-") || !safeActionName.MatchString(parts[3]) {
			return fmt.Errorf("Fail2ban 尚未运行且包含其他防护，请先确认并启动原有服务")
		}
	}
	return nil
}
