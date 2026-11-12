package sshlogin

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"golang.org/x/sys/unix"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"

	"github.com/google/nftables"
)

// Inspect only DDnezha-owned configurations. Another instance must never
// silently override this instance's whitelist or protect the same SSH ports.
func (g *banGuard) checkFB5Ports(p Policy) error {
	if !p.Enabled {
		return nil
	}
	files, e := filepath.Glob(filepath.Join(g.Root, "jail.d", "ddnezha-ssh-*.local"))
	if e != nil {
		return e
	}
	for _, path := range files {
		if path == g.fb5Path() {
			continue
		}
		b, e := os.ReadFile(path)
		if e != nil {
			return e
		}
		if !strings.HasPrefix(string(b), ownedHeader) {
			return fmt.Errorf("另一实例的 SSH 防护配置归属无法确认")
		}
		enabled := false
		ports := []uint16{}
		for _, line := range strings.Split(string(b), "\n") {
			key, value, ok := strings.Cut(line, "=")
			if !ok {
				continue
			}
			key = strings.TrimSpace(key)
			value = strings.TrimSpace(value)
			if key == "enabled" && value == "true" {
				enabled = true
			}
			if key == "port" {
				for _, raw := range strings.Split(value, ",") {
					n, e := strconv.ParseUint(strings.TrimSpace(raw), 10, 16)
					if e != nil {
						return fmt.Errorf("另一实例的 SSH 端口无法确认")
					}
					ports = append(ports, uint16(n))
				}
			}
		}
		if enabled {
			for _, port := range ports {
				if slices.Contains(p.Ports, port) {
					return fmt.Errorf("所选 SSH 端口已由另一 Agent 实例保护")
				}
			}
		}
	}
	return nil
}
func (g *banGuard) checkNativePorts(ctx context.Context, p Policy) error {
	// With no nft command and only legacy iptables, native nftables protection
	// cannot coexist on systems that do not support the nft kernel interface.
	if !p.Enabled {
		return nil
	}
	c, e := newNftConn()
	if e != nil {
		return e
	}
	tables, e := c.ListTablesOfFamily(nftables.TableFamilyINet)
	if e != nil {
		if errors.Is(e, unix.EAFNOSUPPORT) || errors.Is(e, unix.EPROTONOSUPPORT) || errors.Is(e, unix.EOPNOTSUPP) || errors.Is(e, unix.ENOENT) {
			return nil
		}
		return fmt.Errorf("暂时无法核验其他原生 SSH 防护，请检查内核权限")
	}
	own := "ddnz_ssh_" + strings.TrimPrefix(g.Name, "ddnezha-ssh-")
	probe := blacklistGuard{Name: own}
	for _, t := range tables {
		if !strings.HasPrefix(t.Name, "ddnz_ssh_") || probe.isOwnName(t.Name) || !probe.isActive(c, t) {
			continue
		}
		set, e := c.GetSetByName(t, "ports")
		if e != nil {
			return fmt.Errorf("另一实例的 SSH 端口无法确认")
		}
		values, e := c.GetSetElements(set)
		if e != nil {
			return e
		}
		for _, v := range values {
			if len(v.Key) == 2 && slices.Contains(p.Ports, binary.BigEndian.Uint16(v.Key)) {
				return fmt.Errorf("所选 SSH 端口已由另一 Agent 实例保护")
			}
		}
	}
	return ctx.Err()
}
