package sshlogin

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type fb5ImportedStart struct{ Start, EngineStart, Expires int64 }

func (g *banGuard) fb5MetadataPath() string {
	return filepath.Join(g.Dir, "fail2ban-imported-starts.json")
}
func (g *banGuard) readFB5Starts() (map[string]fb5ImportedStart, error) {
	out := map[string]fb5ImportedStart{}
	if g.Dir == "" {
		return out, nil
	}
	path := g.fb5MetadataPath()
	st, e := os.Lstat(path)
	if os.IsNotExist(e) {
		return out, nil
	}
	if e != nil {
		return nil, e
	}
	if !st.Mode().IsRegular() || st.Size() > 2<<20 {
		return nil, fmt.Errorf("封禁迁移记录无效")
	}
	b, e := os.ReadFile(path)
	if e != nil {
		return nil, e
	}
	if e = json.Unmarshal(b, &out); e != nil || len(out) > 10000 {
		return nil, fmt.Errorf("封禁迁移记录无效")
	}
	return out, nil
}
func (g *banGuard) saveFB5Starts(imported, actual []BanEntry, previouslyPresent map[string]bool) error {
	starts, e := g.readFB5Starts()
	if e != nil {
		return e
	}
	current := map[string]BanEntry{}
	for _, entry := range actual {
		current[entry.IP] = entry
	}
	for ip, old := range starts {
		now, ok := current[ip]
		if !ok || now.BannedAt != old.EngineStart || now.ExpiresAt != old.Expires {
			delete(starts, ip)
		}
	}
	for _, entry := range imported {
		now, ok := current[entry.IP]
		if !ok || previouslyPresent[entry.IP] || entry.BannedAt <= 0 {
			continue
		}
		starts[entry.IP] = fb5ImportedStart{Start: entry.BannedAt, EngineStart: now.BannedAt, Expires: now.ExpiresAt}
	}
	body, e := json.Marshal(starts)
	if e != nil {
		return e
	}
	return atomicFile(g.fb5MetadataPath(), body)
}
func (g *banGuard) forgetFB5Start(ip string) error {
	starts, e := g.readFB5Starts()
	if e != nil {
		return e
	}
	if _, ok := starts[ip]; !ok {
		return nil
	}
	delete(starts, ip)
	body, e := json.Marshal(starts)
	if e != nil {
		return e
	}
	return atomicFile(g.fb5MetadataPath(), body)
}
