package singleton

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"github.com/nezhahq/nezha/model"
	"net/netip"
	"slices"
	"strings"
	"time"
)

// CompileSSHBlacklist derives only the administrator's explicit IP/CIDR list.
func CompileSSHBlacklist(ctx context.Context, p *model.SSHLoginPolicy) error {
	if e := ctx.Err(); e != nil {
		return e
	}
	prefixes := []string{}
	if p.Enabled {
		for _, raw := range p.BlockIPs {
			if a, e := netip.ParseAddr(raw); e == nil && a.Zone() == "" {
				a = a.Unmap()
				prefixes = append(prefixes, netip.PrefixFrom(a, a.BitLen()).String())
			} else if prefix, e := netip.ParsePrefix(raw); e == nil && !prefix.Addr().Is4In6() {
				prefixes = append(prefixes, prefix.Masked().String())
			} else {
				return fmt.Errorf("IP 黑名单无效")
			}
		}
	}
	slices.Sort(prefixes)
	prefixes = slices.Compact(prefixes)
	if len(prefixes) > 2000 {
		return fmt.Errorf("黑名单最多 2000 项")
	}
	raw := []byte(strings.Join(prefixes, "\n"))
	hash := sha256.Sum256(raw)
	var compressed bytes.Buffer
	writer := gzip.NewWriter(&compressed)
	if _, e := writer.Write(raw); e != nil {
		return e
	}
	if e := writer.Close(); e != nil {
		return e
	}
	p.BlockData = compressed.Bytes()
	p.BlockHash = hex.EncodeToString(hash[:])
	p.BlockUpdatedAt = time.Now().Unix()
	return nil
}
