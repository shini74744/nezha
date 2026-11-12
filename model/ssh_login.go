package model

import (
	"fmt"
	"net/netip"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"
)

// UUID keeps policies attached to the server when display IDs are reassigned.
type SSHLoginPolicy struct {
	Backend             string           `json:"backend"`
	BlockTimes          map[string]int64 `gorm:"serializer:json" json:"block_times,omitempty"`
	UUID                string           `gorm:"primaryKey;size:64" json:"-"`
	Enabled             bool             `json:"enabled"`
	Success             bool             `json:"success"`
	Failure             bool             `json:"failure"`
	NotificationGroupID uint64           `json:"notification_group_id"`
	Ports               []uint16         `gorm:"serializer:json" json:"ports"`
	AutoBan             bool             `json:"auto_ban"`
	WhitelistOnly       bool             `json:"whitelist_only"`
	MaxRetry            int              `json:"max_retry"`
	FindTime            int              `json:"find_time"`
	BanTime             int              `json:"ban_time"`
	Allowlist           []string         `gorm:"serializer:json" json:"allowlist"`
	BlockIPs            []string         `gorm:"serializer:json" json:"block_ips"`
	BlockHash           string           `json:"block_hash"`
	BlockUpdatedAt      int64            `json:"block_updated_at"`
	BlockData           []byte           `json:"-"`
	Revision            uint64           `json:"revision"`
}

func DefaultSSHLoginPolicy() SSHLoginPolicy {
	return SSHLoginPolicy{Success: true, Failure: true, Ports: []uint16{22}, MaxRetry: 5, FindTime: 600, BanTime: 3600, Allowlist: []string{}}
}
func (p *SSHLoginPolicy) Validate() error {
	if p.Backend != "" && p.Backend != "native" && p.Backend != "fail2ban" {
		return fmt.Errorf("防护方式无效")
	}
	if p.Enabled && (p.Success || p.Failure) && p.NotificationGroupID == 0 {
		return fmt.Errorf("请选择通知组")
	}
	if p.Enabled && p.WhitelistOnly && len(p.Allowlist) == 0 {
		return fmt.Errorf("仅白名单模式需要至少一个有效 IP 或网段")
	}
	if len(p.Ports) == 0 || len(p.Ports) > 32 {
		return fmt.Errorf("请选择 1–32 个 SSH 端口")
	}
	seen := map[uint16]bool{}
	for _, port := range p.Ports {
		if port == 0 || seen[port] {
			return fmt.Errorf("SSH 端口须为不重复的 1–65535 整数")
		}
		seen[port] = true
	}
	slices.Sort(p.Ports)
	if len(p.BlockIPs) > 2000 {
		return fmt.Errorf("黑名单最多 2000 项")
	}
	normalized := []string{}
	for _, raw := range p.BlockIPs {
		v, e := CanonicalSSHSource(raw)
		if e != nil {
			return fmt.Errorf("黑名单仅支持 IP 地址或 CIDR")
		}
		normalized = append(normalized, v)
	}
	slices.Sort(normalized)
	p.BlockIPs = slices.Compact(normalized)

	if p.MaxRetry < 1 || p.MaxRetry > 1000 || p.FindTime < 10 || p.FindTime > 604800 || (p.BanTime != -1 && (p.BanTime < 60 || p.BanTime > 31536000)) {
		return fmt.Errorf("请检查失败次数、统计时间和封禁时长")
	}
	if len(p.Allowlist) > 100 {
		return fmt.Errorf("白名单最多 100 项")
	}
	for i, raw := range p.Allowlist {
		raw = strings.TrimSpace(raw)
		if a, err := netip.ParseAddr(raw); err == nil && a.Zone() == "" {
			p.Allowlist[i] = a.Unmap().String()
			continue
		}
		if prefix, err := netip.ParsePrefix(raw); err == nil && !prefix.Addr().Is4In6() {
			p.Allowlist[i] = prefix.Masked().String()
			continue
		}
		return fmt.Errorf("白名单仅支持 IP 地址或 CIDR")
	}
	return nil
}

type SSHLoginEvent struct {
	UUID       string `gorm:"primaryKey;size:64" json:"-"`
	ID         string `gorm:"primaryKey;size:64" json:"id"`
	Time       int64  `gorm:"index" json:"time"`
	Username   string `json:"username"`
	SourceIP   string `json:"source_ip"`
	SourcePort uint16 `json:"source_port"`
	Port       uint16 `json:"port"`
	Method     string `json:"method"`
	Success    bool   `json:"success"`
	Reason     string `json:"reason"`
	ReceivedAt int64  `gorm:"index" json:"-"`
	SentAt     int64  `gorm:"index" json:"-"`
	RetryAt    int64  `json:"-"`
}

func (e SSHLoginEvent) Validate(now int64) error {
	if len(e.ID) != 64 || strings.Trim(e.ID, "0123456789abcdef") != "" {
		return fmt.Errorf("invalid event id")
	}
	if e.Time < now-86400000 || e.Time > now+300000 {
		return fmt.Errorf("invalid event time")
	}
	ip, err := netip.ParseAddr(e.SourceIP)
	if err != nil || ip.Zone() != "" || ip.IsUnspecified() {
		return fmt.Errorf("invalid source")
	}
	if !utf8.ValidString(e.Username+e.Method+e.Reason) || e.Username == "" || utf8.RuneCountInString(e.Username) > 128 || strings.IndexFunc(e.Username, unicode.IsControl) >= 0 {
		return fmt.Errorf("invalid username")
	}
	if len(e.Method) > 64 || len(e.Reason) > 256 || strings.IndexFunc(e.Method+e.Reason, unicode.IsControl) >= 0 {
		return fmt.Errorf("invalid authentication result")
	}
	return nil
}

type SSHExisting struct {
	Active    bool     `json:"active"`
	Ports     []uint16 `json:"ports"`
	MaxRetry  int      `json:"max_retry"`
	FindTime  int      `json:"find_time"`
	BanTime   int      `json:"ban_time"`
	Allowlist []string `json:"allowlist"`
}
type SSHLoginStatus struct {
	Backend           string       `json:"backend"`
	BackendSelection  bool         `json:"backend_selection"`
	AutoBanActive     bool         `json:"auto_ban_active"`
	BanPaging         bool         `json:"ban_paging"`
	BanTotal          int          `json:"ban_total"`
	ImportedAllowlist []string     `json:"imported_allowlist,omitempty"`
	Existing          *SSHExisting `gorm:"-" json:"existing,omitempty"`
	Reused            bool         `json:"reused"`
	Migrated          bool         `json:"migrated"`
	UUID              string       `gorm:"primaryKey;size:64" json:"-"`
	UpdatedAt         int64        `json:"updated_at"`
	Revision          uint64       `json:"revision"`
	Source            string       `json:"source"`
	Message           string       `json:"message"`
	Ports             []uint16     `gorm:"serializer:json" json:"ports"`
	Banned            []string     `gorm:"serializer:json" json:"banned"`
	BanReady          bool         `json:"ban_ready"`
	BlockReady        bool         `json:"block_ready"`
	BlockHash         string       `json:"block_hash"`
	ReceivedHash      string       `json:"received_hash"`
	Dropped           uint64       `json:"dropped"`
}
type SSHUnbanCommand struct {
	ID        uint64 `gorm:"primaryKey" json:"id"`
	UUID      string `gorm:"index;size:64" json:"-"`
	IP        string `json:"ip"`
	CreatedAt int64  `json:"-"`
	Done      bool   `json:"-"`
}
type SSHLoginReport struct {
	BanPage   *SSHBanPage     `json:"ban_page,omitempty"`
	Events    []SSHLoginEvent `json:"events"`
	Recent    []SSHLoginEvent `json:"recent,omitempty"`
	QueryID   uint64          `json:"query_id,omitempty"`
	Status    SSHLoginStatus  `json:"status"`
	Completed []uint64        `json:"completed"`
}
type SSHLoginReply struct {
	BanQuery     *SSHBanQuery      `json:"ban_query,omitempty"`
	PrefixesGzip []byte            `json:"prefixes_gzip,omitempty"`
	Policy       SSHLoginPolicy    `json:"policy"`
	QueryID      uint64            `json:"query_id,omitempty"`
	Prefixes     []string          `json:"prefixes,omitempty"`
	Unban        []SSHUnbanCommand `json:"unban"`
}

type SSHLoginReceipt struct {
	UUID       string `gorm:"primaryKey;size:64"`
	ID         string `gorm:"primaryKey;size:64"`
	AcceptedAt int64  `gorm:"index"`
}

type SSHBanEntry struct {
	IP        string `json:"ip"`
	BannedAt  int64  `json:"banned_at"`
	ExpiresAt int64  `json:"expires_at"`
}
type SSHBanQuery struct {
	ID       uint64 `json:"id"`
	Search   string `json:"search"`
	Page     int    `json:"page"`
	PageSize int    `json:"page_size"`
}
type SSHBanPage struct {
	QueryID    uint64        `json:"query_id,omitempty"`
	Items      []SSHBanEntry `json:"items"`
	Total      int           `json:"total"`
	Page       int           `json:"page"`
	PageSize   int           `json:"page_size"`
	ObservedAt int64         `json:"observed_at"`
	Complete   bool          `json:"complete"`
	Error      string        `json:"error,omitempty"`
}

func CanonicalSSHSource(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if a, e := netip.ParseAddr(raw); e == nil && a.Zone() == "" {
		return a.Unmap().String(), nil
	}
	if p, e := netip.ParsePrefix(raw); e == nil && !p.Addr().Is4In6() {
		p = p.Masked()
		if p.Bits() == p.Addr().BitLen() {
			return p.Addr().String(), nil
		}
		return p.String(), nil
	}
	return "", fmt.Errorf("IP 地址或网段无效")
}
func (p *SSHLoginPolicy) KeepSSHBlockTimes(old SSHLoginPolicy, now int64) {
	existing := map[string]int64{}
	for _, v := range old.BlockIPs {
		k, e := CanonicalSSHSource(v)
		if e == nil {
			existing[k] = old.BlockTimes[v]
			if existing[k] == 0 {
				existing[k] = old.BlockTimes[k]
			}
		}
	}
	next := map[string]int64{}
	for _, v := range p.BlockIPs {
		if at, ok := existing[v]; ok {
			next[v] = at
		} else {
			next[v] = now
		}
	}
	p.BlockTimes = next
}

func (p SSHLoginPolicy) Engine() string {
	if p.Backend == "fail2ban" {
		return "fail2ban"
	}
	return "native"
}
