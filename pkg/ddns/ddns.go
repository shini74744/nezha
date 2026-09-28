package ddns

import (
	"context"
	"fmt"
	"log"
	"net/netip"
	"strings"
	"time"

	"github.com/libdns/libdns"
	"github.com/miekg/dns"

	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/utils"
)

type DNSServerKey struct{}

const (
	dnsTimeOut = 10 * time.Second
)

type Provider struct {
	DDNSProfile *model.DDNSProfile
	IPAddrs     *model.IP
	Setter      libdns.RecordSetter
}

func (provider *Provider) GetProfileID() uint64 {
	return provider.DDNSProfile.ID
}

// UpdateResult describes the final outcome after retries, without provider errors
// that can contain secrets. One result is returned per enabled domain/record.
type UpdateResult struct {
	Domain     string
	RecordType string
	IP         string
	Action     string
	Success    bool
	Detail     string
	Attempts   int
}

func (provider *Provider) UpdateDomain(ctx context.Context, overrideDomains ...string) []UpdateResult {
	domains := utils.IfOr(len(overrideDomains) > 0, overrideDomains, provider.DDNSProfile.Domains)
	maxRetries := int(provider.DDNSProfile.MaxRetries)
	if maxRetries <= 0 {
		maxRetries = 1
	}
	var results []UpdateResult
	for _, domain := range domains {
		var prefix, zone string
		var soaErr error
		for retries := 0; retries < maxRetries; retries++ {
			prefix, zone, soaErr = provider.splitDomainSOA(ctx, domain)
			if soaErr == nil {
				break
			}
			log.Printf("NEZHA>> Failed to split domain SOA for %s (attempt %d/%d): %v", domain, retries+1, maxRetries, soaErr)
		}
		for _, rec := range []struct {
			kind, ip string
			enabled  *bool
		}{
			{"A", provider.IPAddrs.IPv4Addr, provider.DDNSProfile.EnableIPv4},
			{"AAAA", provider.IPAddrs.IPv6Addr, provider.DDNSProfile.EnableIPv6},
		} {
			if rec.enabled == nil || !*rec.enabled {
				continue
			}
			r := UpdateResult{Domain: domain, RecordType: rec.kind, IP: rec.ip, Action: "更新"}
			if rec.ip == "" {
				r.Action = "删除"
			}
			if soaErr != nil {
				r.Detail = "无法确定域名 SOA，未执行记录更新"
				r.Attempts = maxRetries
				results = append(results, r)
				continue
			}
			if rec.ip == "" {
				if _, ok := provider.Setter.(libdns.RecordDeleter); !ok {
					r.Detail = "提供商不支持删除记录，未执行删除"
					results = append(results, r)
					continue
				}
			}
			for retries := 0; retries < maxRetries; retries++ {
				r.Attempts = retries + 1
				var err error
				if rec.ip == "" {
					err = provider.deleteDomainRecord(ctx, prefix, zone, rec.kind)
				} else {
					err = provider.addDomainRecord(ctx, prefix, zone, rec.kind, rec.ip)
				}
				if err == nil {
					r.Success = true
					break
				}
				log.Printf("NEZHA>> Failed to update %s record for %s (attempt %d/%d): %v", rec.kind, domain, retries+1, maxRetries, err)
			}
			if r.Success {
				r.Detail = r.Action + "请求执行成功（DNS 缓存生效可能延迟）"
			} else {
				r.Detail = r.Action + "失败，已用尽重试次数；请检查 DNS 服务商配置和网络"
			}
			if provider.DDNSProfile.Provider == model.ProviderDummy && r.Success {
				r.Detail = "模拟提供商执行完成，未修改 DNS 记录"
			}
			results = append(results, r)
		}
	}
	return results
}

func (provider *Provider) addDomainRecord(ctx context.Context, prefix, zone, recType, addr string) error {
	netipAddr, err := netip.ParseAddr(addr)
	if err != nil {
		return fmt.Errorf("parse error: %v", err)
	}

	_, err = provider.Setter.SetRecords(ctx, zone,
		[]libdns.Record{
			libdns.Address{
				Name: prefix,
				IP:   netipAddr,
				TTL:  time.Minute,
			},
		})
	return err
}

func (provider *Provider) deleteDomainRecord(ctx context.Context, prefix, zone, recType string) error {
	deleter, okDeleter := provider.Setter.(libdns.RecordDeleter)
	if !okDeleter {
		log.Printf("NEZHA>> DNS provider does not support RecordDeleter, safely skipping deletion for %s", recType)
		return nil
	}

	targetRecType := strings.ToUpper(recType)
	_, err := deleter.DeleteRecords(ctx, zone, []libdns.Record{
		libdns.RR{
			Name: prefix,
			Type: targetRecType,
		},
	})
	if err != nil {
		return fmt.Errorf("deleter.DeleteRecords failed: %w", err)
	}

	log.Printf("NEZHA>> Successfully deleted %s record for %s.%s", recType, prefix, zone)
	return nil
}

func (provider *Provider) splitDomainSOA(ctx context.Context, domain string) (prefix string, zone string, err error) {
	c := &dns.Client{Timeout: dnsTimeOut}

	domain += "."
	indexes := dns.Split(domain)

	servers := utils.DNSServers
	customDNSServers, _ := ctx.Value(DNSServerKey{}).([]string)
	if len(customDNSServers) > 0 {
		servers = customDNSServers
	}

	for _, server := range servers {
		for _, idx := range indexes {
			var m dns.Msg
			m.SetQuestion(domain[idx:], dns.TypeSOA)

			r, _, err := c.Exchange(&m, server)
			if err != nil {
				continue
			}

			if r != nil && len(r.Answer) > 0 {
				if soa, ok := r.Answer[0].(*dns.SOA); ok {
					zoneName := soa.Hdr.Name
					pfx := libdns.RelativeName(domain, zoneName)
					if pfx == "@" {
						pfx = ""
					}
					return pfx, zoneName, nil
				}
			}
		}
	}

	return "", "", fmt.Errorf("SOA record not found for domain: %s", domain)
}
