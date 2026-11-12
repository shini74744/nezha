package sshlogin

import (
	"context"
	"fmt"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
)

const ownedHeader = "# Managed by DDnezha SSH protection.\n"

type banGuard struct {
	Name, Dir, Root string
	fb5Cache        *fb5BanCache
	Ready           bool
	Reused          bool
	Exec            func(context.Context, string, ...string) ([]byte, error)
}

func writeOwned(path string, body []byte) error {
	if st, e := os.Lstat(path); e == nil {
		if !st.Mode().IsRegular() {
			return fmt.Errorf("不是本功能的普通文件")
		}
		old, e := os.ReadFile(path)
		if e != nil || !strings.HasPrefix(string(old), ownedHeader) {
			return fmt.Errorf("已有文件不属于本功能")
		}
	} else if !os.IsNotExist(e) {
		return e
	}
	return atomicFile(path, body)
}
func atomicFile(path string, body []byte) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".ddnz-ssh-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	if err = f.Chmod(0600); err == nil {
		_, err = f.Write(body)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
func (g *banGuard) banned(ctx context.Context) []string {
	if !g.Ready {
		return []string{}
	}
	out, err := g.Exec(ctx, "fail2ban-client", "get", g.target(), "banip")
	if err != nil {
		g.Ready = false
		return []string{}
	}
	result := []string{}
	for _, raw := range strings.Fields(strings.NewReplacer("[", " ", "]", " ", ",", " ", "'", " ", "\"", " ").Replace(string(out))) {
		if ip, e := netip.ParseAddr(raw); e == nil && ip.Zone() == "" {
			result = append(result, ip.Unmap().String())
		}
		if len(result) >= 1000 {
			break
		}
	}
	return result
}
func (g *banGuard) unban(ctx context.Context, ip string) error {
	g.invalidateFB5Cache()
	a, err := netip.ParseAddr(ip)
	if err != nil || a.Zone() != "" {
		return fmt.Errorf("无效 IP")
	}
	_, err = g.Exec(ctx, "fail2ban-client", "set", g.target(), "unbanip", a.Unmap().String())
	if err == nil && !g.Reused {
		err = g.forgetFB5Start(a.Unmap().String())
	}
	return err
}
