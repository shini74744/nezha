package sshlogin

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/netip"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/nezhahq/agent/scripts/sshsecurity"
)

func (g *banGuard) fb5Jails() []string { return []string{g.Name, g.Name + "-sources"} }
func (g *banGuard) fb5Path() string    { return filepath.Join(g.Root, "jail.d", g.Name+".local") }
func (g *banGuard) fb5Script() (string, error) {
	path := filepath.Join(g.Dir, "fail2ban-ssh.sh")
	if e := privateDir(g.Dir); e != nil {
		return "", e
	}
	return path, writeOwned(path, append([]byte(ownedHeader), sshsecurity.Script...))
}
func (g *banGuard) fb5Files(p Policy, prefixes []string, source, firewall string) (map[string][]byte, string, error) {
	if e := p.Validate(); e != nil {
		return nil, "", e
	}
	if !safeActionName.MatchString(g.Name) || !strings.HasPrefix(g.Name, "ddnezha-ssh-") {
		return nil, "", fmt.Errorf("防护实例名称无效")
	}
	key := strings.TrimPrefix(g.Name, "ddnezha-ssh-")
	if strings.ContainsAny(g.Dir+g.Root, " \t\n'\";$\x60") {
		return nil, "", fmt.Errorf("防护目录无效")
	}
	script, e := fail2banSources(p, prefixes, key, firewall)
	if e != nil {
		return nil, "", e
	}
	signature := fmt.Sprintf("%x", sha256.Sum256([]byte(script)))
	helper := filepath.Join(g.Dir, "sources-"+signature[:16]+".sh")
	actionName := g.Name + "-sources"
	sourceEnabled := p.Enabled && (p.WhitelistOnly || len(prefixes) > 0)
	ports := []string{}
	for _, v := range p.Ports {
		ports = append(ports, strconv.Itoa(int(v)))
	}
	action := ""
	if firewall == "nftables" {
		action = fmt.Sprintf("nftables[type=multiport, name=ddnz-%s, port=\"%s\", protocol=tcp, table=f2b_ddnz_auto_%s, chain=ssh, chain_type=filter, chain_hook=input, chain_priority=-1, table_family=inet, blocktype=drop]", key, strings.Join(ports, ","), key)
	} else {
		for start := 0; start < len(ports); start += 15 {
			if action != "" {
				action += "\n         "
			}
			action += fmt.Sprintf("iptables[type=multiport, actname=ddnz-%d, name=ddnz%s%d, port=\"%s\", protocol=tcp, chain=INPUT, blocktype=DROP]", start/15, key, start/15, strings.Join(ports[start:min(start+15, len(ports))], ","))
		}
	}
	// Port verification and log parsing are shared with native mode. Fail2ban
	// owns failure counting, persistence, expiry and firewall actions.
	logConfig := "backend = polling\nlogpath = " + g.fb5EventPath() + " tail\n"
	if e := g.ensureFB5EventLog(); e != nil {
		return nil, "", e
	}
	filterName := g.Name + "-events"
	portPattern := strings.Join(ports, "|")
	filterConfig := "[Definition]\ndatepattern = {EPOCH}\nfailregex = ^\\s*DDNEZHA-SSH port=(?:" + portPattern + ") ip=<HOST> id=[a-f0-9]{64}$\nignoreregex =\n"
	empty := filepath.Join(g.Dir, "fail2ban-empty.log")
	jail := fmt.Sprintf("[%s]\nenabled = %t\nfilter = %s\n%susedns = no\nport = %s\nmaxretry = %d\nfindtime = %d\nbantime = %d\nignoreip = 127.0.0.0/8 ::1 %s\naction = %s\n\n[%s]\nenabled = %t\nbackend = polling\nfilter = %s\nlogpath = %s\nusedns = no\naction = %s\n", g.Name, p.Enabled && p.AutoBan, filterName, logConfig, strings.Join(ports, ","), p.MaxRetry, p.FindTime, p.BanTime, strings.Join(p.Allowlist, " "), action, g.Name+"-sources", sourceEnabled, actionName, empty, actionName)
	actionConfig := fmt.Sprintf("[Definition]\nactionstart = /bin/sh '%s' start\nactionstop = /bin/sh '%s' stop\nactioncheck = /bin/sh '%s' check\nactionban =\nactionunban =\nactionstart_on_demand = false\n", helper, helper, helper)
	files := map[string][]byte{
		g.fb5Path(): []byte(ownedHeader + jail),
		filepath.Join(g.Root, "filter.d", filterName+".conf"): []byte(ownedHeader + filterConfig),
		filepath.Join(g.Root, "action.d", actionName+".conf"): []byte(ownedHeader + actionConfig),
		filepath.Join(g.Root, "filter.d", actionName+".conf"): []byte(ownedHeader + "[Definition]\nfailregex = ^DDNEZHA-NO-EVENT <HOST>$\nignoreregex =\n"),
		helper: []byte(ownedHeader + script),
	}
	if _, e = os.Lstat(empty); os.IsNotExist(e) {
		files[empty] = []byte(ownedHeader)
	} else if e != nil {
		return nil, "", e
	}
	return files, helper, nil
}
func (g *banGuard) readFB5RawBans(ctx context.Context, now time.Time) ([]BanEntry, error) {
	raw, e := g.Exec(ctx, "fail2ban-client", "get", g.Name, "banip", "--with-time")
	if e != nil {
		return nil, e
	}
	bans, e := parseTimedBans(string(raw), now)
	if e != nil {
		return nil, e
	}
	starts := parseTimedBanStarts(string(raw))
	out := []BanEntry{}
	for ip, until := range bans {
		out = append(out, BanEntry{IP: ip, BannedAt: starts[ip], ExpiresAt: until})
	}
	return out, nil
}

func (g *banGuard) readFB5Bans(ctx context.Context, now time.Time) ([]BanEntry, error) {
	if g.fb5Cache != nil && time.Since(g.fb5Cache.at) < 2*time.Second {
		return slices.Clone(g.fb5Cache.entries), nil
	}

	entries, e := g.readFB5RawBans(ctx, now)
	if e != nil {
		return nil, e
	}
	starts, e := g.readFB5Starts()
	if e != nil {
		return nil, e
	}
	for i, entry := range entries {
		if old, ok := starts[entry.IP]; ok && old.EngineStart == entry.BannedAt && old.Expires == entry.ExpiresAt {
			entries[i].BannedAt = old.Start
		}
	}
	if g.fb5Cache == nil {
		g.fb5Cache = &fb5BanCache{}
	}
	g.fb5Cache.at = time.Now()
	g.fb5Cache.entries = slices.Clone(entries)
	return entries, nil
}

// importFB5Bans pauses only our jail while applying per-IP remaining lifetimes.
// No Fail2ban-wide restart, unban-all or configuration update is ever used.
func (g *banGuard) importFB5Bans(ctx context.Context, p Policy, entries []BanEntry) error {
	g.invalidateFB5Cache()
	if !p.Enabled || !p.AutoBan || len(entries) == 0 {
		return nil
	}
	if _, e := g.Exec(ctx, "fail2ban-client", "set", g.Name, "idle", "on"); e != nil {
		return e
	}
	defer g.Exec(context.WithoutCancel(ctx), "fail2ban-client", "set", g.Name, "idle", "off")
	defer g.Exec(context.WithoutCancel(ctx), "fail2ban-client", "set", g.Name, "bantime", strconv.Itoa(p.BanTime))
	actual, e := g.readFB5RawBans(ctx, time.Now())
	if e != nil {
		return e
	}
	seen := map[string]bool{}
	for _, v := range actual {
		seen[v.IP] = true
	}
	originalSeen := map[string]bool{}
	for ip, v := range seen {
		originalSeen[ip] = v
	}
	groups := map[int64][]string{}
	for _, v := range entries {
		ip, e := netip.ParseAddr(v.IP)
		if e != nil || ip.Zone() != "" {
			return fmt.Errorf("原有封禁地址无效")
		}
		if p.allowed(ip) || seen[v.IP] {
			continue
		}
		seconds := int64(-1)
		if v.ExpiresAt > 0 {
			seconds = (v.ExpiresAt - time.Now().UnixMilli() + 999) / 1000
			if seconds <= 0 {
				continue
			}
		}
		groups[seconds] = append(groups[seconds], ip.Unmap().String())
	}
	for seconds, ips := range groups {
		if _, e = g.Exec(ctx, "fail2ban-client", "set", g.Name, "bantime", strconv.FormatInt(seconds, 10)); e != nil {
			return e
		}
		for start := 0; start < len(ips); start += 100 {
			args := append([]string{"set", g.Name, "banip"}, ips[start:min(start+100, len(ips))]...)
			if _, e = g.Exec(ctx, "fail2ban-client", args...); e != nil {
				return e
			}
		}
	}
	actual, e = g.readFB5RawBans(ctx, time.Now())
	if e != nil {
		return e
	}
	seen = map[string]bool{}
	for _, v := range actual {
		seen[v.IP] = true
	}
	for _, ips := range groups {
		for _, ip := range ips {
			if !seen[ip] {
				return fmt.Errorf("封禁迁移尚未完成")
			}
		}
	}
	if e := g.verifyFB5Bans(ctx, p, actual); e != nil {
		return e
	}
	return g.saveFB5Starts(entries, actual, originalSeen)
}

func (g *banGuard) configureFB5(ctx context.Context, p Policy, prefixes []string, source string) error {
	if e := g.checkFB5Ports(p); e != nil {
		return e
	}
	if e := g.checkNativePorts(ctx, p); e != nil {
		return e
	}
	script, e := g.fb5Script()
	if e != nil {
		return e
	}
	raw, e := g.Exec(ctx, "/bin/sh", script, "firewall")
	if e != nil {
		return fmt.Errorf("未找到支持的 SSH 防火墙组件")
	}
	firewall := strings.TrimSpace(string(raw))
	files, helper, e := g.fb5Files(p, prefixes, source, firewall)
	if e != nil {
		return e
	}
	if e = g.startFail2ban(ctx); e != nil {
		return e
	}
	previous := map[string][]byte{}
	changed := false
	for path, body := range files {
		old, err := os.ReadFile(path)
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		if err == nil && !strings.HasPrefix(string(old), ownedHeader) {
			return fmt.Errorf("已有配置不属于 DDnezha，未修改")
		}
		previous[path] = old
		changed = changed || string(old) != string(body)
	}

	restartAutomatic := changed && fb5ActionSignature(previous[g.fb5Path()]) != fb5ActionSignature(files[g.fb5Path()])
	var preserved []BanEntry
	if restartAutomatic {
		if _, running := g.Exec(ctx, "fail2ban-client", "status", g.Name); running == nil {
			g.invalidateFB5Cache()
			preserved, e = g.readFB5Bans(ctx, time.Now())
			if e != nil {
				return fmt.Errorf("原封禁无法读取，设置未修改")
			}
		}
	}
	// Persist a rollback bundle before modifying any active config.
	if changed {
		g.invalidateFB5Cache()
		backup := filepath.Join(g.Dir, "fail2ban-backup")
		if e = privateDir(backup); e != nil {
			return e
		}
		b, _ := json.Marshal(previous)
		path := filepath.Join(backup, fmt.Sprintf("%d-%d.json", p.Revision, time.Now().UnixNano()))
		if e = atomicFile(path, b); e != nil {
			return e
		}
		for path, body := range files {
			if e = privateDir(filepath.Dir(path)); e != nil {
				g.restoreFB5Files(previous)
				return e
			}
			if e = writeOwned(path, body); e != nil {
				g.restoreFB5Files(previous)
				return e
			}
		}
	}
	rollback := func() {
		g.restoreFB5Files(previous)
		for _, jail := range g.fb5Jails() {
			if previous[g.fb5Path()] == nil {
				_, _ = g.Exec(context.WithoutCancel(ctx), "fail2ban-client", "stop", jail)
			} else {
				_, _ = g.Exec(context.WithoutCancel(ctx), "fail2ban-client", "reload", "--restart", jail)
			}
		}
	}
	if changed {
		if _, e = g.Exec(ctx, "fail2ban-client", "-t"); e != nil {
			if changed {
				g.restoreFB5Files(previous)
			}
			return fmt.Errorf("Fail2ban 配置检查失败，原配置保留")
		}
	}
	for index, jail := range g.fb5Jails() {
		enabled := p.Enabled && p.AutoBan
		if index == 1 {
			enabled = p.Enabled && (len(prefixes) > 0 || p.WhitelistOnly)
		}
		_, running := g.Exec(ctx, "fail2ban-client", "status", jail)
		if !changed && ((enabled && running == nil) || (!enabled && running != nil)) {
			continue
		}
		args := []string{"reload", "--if-exists", jail}
		if running == nil && (index == 1 || restartAutomatic) {
			args = []string{"reload", "--restart", jail}
		}
		if _, e = g.Exec(ctx, "fail2ban-client", args...); e != nil {
			// Reloading an already absent, disabled jail is harmless.
			if !enabled && running != nil {
				continue
			}
			rollback()
			return fmt.Errorf("Fail2ban 设置未能生效，已尝试恢复原配置，请检查防护状态")
		}
		if enabled {
			if _, e = g.Exec(ctx, "fail2ban-client", "status", jail); e != nil {
				rollback()
				return fmt.Errorf("Fail2ban 防护尚未启动")
			}
		}
	}

	if restartAutomatic && p.Enabled && p.AutoBan && len(preserved) > 0 {
		if e = g.importFB5Bans(ctx, p, preserved); e != nil {
			rollback()
			return e
		}
	}
	if p.Enabled && (len(prefixes) > 0 || p.WhitelistOnly) {
		// Fail2ban applies actionstart asynchronously; wait only for the owned action.
		for attempt := 0; attempt < 15; attempt++ {
			if _, e = g.Exec(ctx, "/bin/sh", helper, "check"); e == nil {
				break
			}
			select {
			case <-ctx.Done():
				rollback()
				return ctx.Err()
			case <-time.After(100 * time.Millisecond):
			}
		}
		if e != nil {
			rollback()
			return fmt.Errorf("Fail2ban 来源规则未生效，已尝试恢复原配置，请检查防护状态")
		}
	}
	if p.Enabled && p.AutoBan {
		// Recover an interrupted import/cutover without restarting a shared
		// service. Only our jail's temporary runtime overrides are reset.
		if _, e := g.Exec(ctx, "fail2ban-client", "set", g.Name, "bantime", strconv.Itoa(p.BanTime)); e != nil {
			return e
		}
		if _, e := g.Exec(ctx, "fail2ban-client", "set", g.Name, "idle", "off"); e != nil {
			return e
		}
		entries, e := g.readFB5Bans(ctx, time.Now())
		if e != nil {
			return fmt.Errorf("Fail2ban 封禁列表读取失败")
		}
		for _, v := range entries {
			ip, _ := netip.ParseAddr(v.IP)
			if p.allowed(ip) {
				if e = g.unban(ctx, v.IP); e != nil {
					return e
				}
			}
		}
		if e := g.verifyFB5Bans(ctx, p, entries); e != nil {
			return e
		}
	}
	return nil
}
func (g *banGuard) restoreFB5Files(files map[string][]byte) {
	for path, body := range files {
		if body != nil {
			_ = writeOwned(path, body)
			continue
		}
		old, e := os.ReadFile(path)
		if e == nil && strings.HasPrefix(string(old), ownedHeader) {
			_ = os.Remove(path)
		}
	}
}
func (g *banGuard) disableFB5(ctx context.Context) error {
	g.invalidateFB5Cache()
	if _, e := exec.LookPath("fail2ban-client"); e != nil {
		return nil
	}
	path := g.fb5Path()
	old, e := os.ReadFile(path)
	if os.IsNotExist(e) {
		return nil
	}
	if e != nil {
		return e
	}
	if !strings.HasPrefix(string(old), ownedHeader) {
		return fmt.Errorf("Fail2ban 配置归属无法确认")
	}
	off := ownedHeader
	for _, jail := range g.fb5Jails() {
		off += fmt.Sprintf("[%s]\nenabled = false\n", jail)
	}
	if e = writeOwned(path, []byte(off)); e != nil {
		return e
	}
	for _, jail := range g.fb5Jails() {
		if _, e = g.Exec(ctx, "fail2ban-client", "status", jail); e != nil {
			continue
		}
		if _, e = g.Exec(ctx, "fail2ban-client", "stop", jail); e != nil {
			_ = writeOwned(path, old)
			for _, restore := range g.fb5Jails() {
				_, _ = g.Exec(context.WithoutCancel(ctx), "fail2ban-client", "reload", restore)
			}
			return fmt.Errorf("旧 Fail2ban 防护尚未停止")
		}
	}
	return nil
}
func banEntries(n nativeState) []BanEntry {
	out := []BanEntry{}
	for ip, until := range n.Bans {
		out = append(out, BanEntry{IP: ip, BannedAt: n.BanStarts[ip], ExpiresAt: until})
	}
	slices.SortFunc(out, func(a, b BanEntry) int { return strings.Compare(a.IP, b.IP) })
	return out
}

type fb5BanCache struct {
	at      time.Time
	entries []BanEntry
}

func (g *banGuard) invalidateFB5Cache() {
	if g.fb5Cache != nil {
		g.fb5Cache.at = time.Time{}
		g.fb5Cache.entries = nil
	}
}

// Fail2ban reload alone may retain the old action ports. Restart only our jail
// when action parameters change, after capturing its bans and remaining lifetimes.
func fb5ActionSignature(config []byte) string {
	lines := []string{}
	for _, line := range strings.Split(string(config), "\n") {
		if strings.HasPrefix(line, "action = ") || strings.HasPrefix(line, "         ") || strings.HasPrefix(line, "port = ") {
			lines = append(lines, line)
		}
	}
	return strings.Join(lines, "\n")
}
