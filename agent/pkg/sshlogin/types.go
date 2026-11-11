package sshlogin

import (
	"context"
	"fmt"
	"net/netip"
	"slices"
	"strings"
)

type Policy struct {
	Enabled             bool     `json:"enabled"`
	Success             bool     `json:"success"`
	Failure             bool     `json:"failure"`
	NotificationGroupID uint64   `json:"notification_group_id"`
	Ports               []uint16 `json:"ports"`
	AutoBan             bool     `json:"auto_ban"`
	WhitelistOnly       bool     `json:"whitelist_only"`
	MaxRetry            int      `json:"max_retry"`
	FindTime            int      `json:"find_time"`
	BanTime             int      `json:"ban_time"`
	Allowlist           []string `json:"allowlist"`
	BlockIPs            []string `json:"block_ips"`
	BlockHash           string   `json:"block_hash"`
	BlockUpdatedAt      int64    `json:"block_updated_at"`
	Revision            uint64   `json:"revision"`
}

func (p Policy) Validate() error {
	if p.Enabled && p.WhitelistOnly && len(p.Allowlist) == 0 {
		return fmt.Errorf("仅白名单模式需要至少一个有效 IP 或网段")
	}
	if len(p.Ports) < 1 || len(p.Ports) > 32 {
		return fmt.Errorf("invalid ports")
	}
	seen := map[uint16]bool{}
	for _, port := range p.Ports {
		if port == 0 || seen[port] {
			return fmt.Errorf("invalid ports")
		}
		seen[port] = true
	}
	if p.MaxRetry < 1 || p.MaxRetry > 1000 || p.FindTime < 10 || p.FindTime > 604800 || (p.BanTime != -1 && (p.BanTime < 60 || p.BanTime > 31536000)) {
		return fmt.Errorf("invalid protection parameters")
	}
	if len(p.Allowlist) > 100 {
		return fmt.Errorf("invalid allowlist")
	}
	for _, v := range p.Allowlist {
		if a, e := netip.ParseAddr(v); e == nil && a.Zone() == "" {
			continue
		}
		if prefix, e := netip.ParsePrefix(v); e != nil || prefix.Addr().Is4In6() {
			return fmt.Errorf("invalid allowlist")
		}
	}
	return nil
}
func (p Policy) Includes(e Event) bool { return e.Port == 0 || slices.Contains(p.Ports, e.Port) }
func (p Policy) Protected(e Event) bool {
	if !p.Enabled || !p.AutoBan || e.Success || e.Port == 0 || !slices.Contains(p.Ports, e.Port) {
		return false
	}
	ip, err := netip.ParseAddr(e.SourceIP)
	if err != nil || ip.Zone() != "" {
		return false
	}
	ip = ip.Unmap()
	if ip.IsLoopback() || ip.IsUnspecified() {
		return false
	}
	for _, raw := range p.Allowlist {
		if a, err := netip.ParseAddr(raw); err == nil && a.Unmap() == ip.Unmap() {
			return false
		}
		if prefix, err := netip.ParsePrefix(raw); err == nil && prefix.Contains(ip) {
			return false
		}
	}
	return true
}

type ExistingSSH struct {
	Active    bool     `json:"active"`
	Ports     []uint16 `json:"ports"`
	MaxRetry  int      `json:"max_retry"`
	FindTime  int      `json:"find_time"`
	BanTime   int      `json:"ban_time"`
	Allowlist []string `json:"allowlist"`
}
type Status struct {
	BanPaging         bool         `json:"ban_paging"`
	BanTotal          int          `json:"ban_total"`
	ImportedAllowlist []string     `json:"imported_allowlist,omitempty"`
	Existing          *ExistingSSH `json:"existing,omitempty"`
	Reused            bool         `json:"reused"`
	Migrated          bool         `json:"migrated"`
	Revision          uint64       `json:"revision"`
	Source            string       `json:"source"`
	Message           string       `json:"message"`
	Ports             []uint16     `json:"ports"`
	Banned            []string     `json:"banned"`
	BanReady          bool         `json:"ban_ready"`
	BlockReady        bool         `json:"block_ready"`
	BlockHash         string       `json:"block_hash"`
	ReceivedHash      string       `json:"received_hash"`
	Dropped           uint64       `json:"dropped"`
}
type Command struct {
	ID uint64 `json:"id"`
	IP string `json:"ip"`
}
type Report struct {
	BanPage   *BanPage `json:"ban_page,omitempty"`
	Events    []Event  `json:"events"`
	Recent    []Event  `json:"recent,omitempty"`
	QueryID   uint64   `json:"query_id,omitempty"`
	Status    Status   `json:"status"`
	Completed []uint64 `json:"completed"`
}
type Reply struct {
	BanQuery     *BanQuery `json:"ban_query,omitempty"`
	PrefixesGzip []byte    `json:"prefixes_gzip,omitempty"`
	Policy       Policy    `json:"policy"`
	QueryID      uint64    `json:"query_id,omitempty"`
	Prefixes     []string  `json:"prefixes,omitempty"`
	Unban        []Command `json:"unban"`
}
type Exchange func(context.Context, Report) (Reply, error)

func SafeIdentity(raw string) bool { return raw != "" && !strings.ContainsAny(raw, "\r\n") }

type BanEntry struct {
	IP        string `json:"ip"`
	BannedAt  int64  `json:"banned_at"`
	ExpiresAt int64  `json:"expires_at"`
}
type BanQuery struct {
	ID       uint64 `json:"id"`
	Search   string `json:"search"`
	Page     int    `json:"page"`
	PageSize int    `json:"page_size"`
}
type BanPage struct {
	QueryID    uint64     `json:"query_id,omitempty"`
	Items      []BanEntry `json:"items"`
	Total      int        `json:"total"`
	Page       int        `json:"page"`
	PageSize   int        `json:"page_size"`
	ObservedAt int64      `json:"observed_at"`
	Complete   bool       `json:"complete"`
	Error      string     `json:"error,omitempty"`
}
