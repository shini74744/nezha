package networkinsight

import (
	"encoding/json"
	"fmt"
	"net/netip"
	"strconv"
	"strings"
	"unicode"
)

const ReturnOutputLimit = 256 * 1024

// The only downloaded artifact is a pinned, digest-verified NextTrace binary.
// No remote shell script, package manager, speed test, or report upload is used.
func ReturnCommand(target, family, protocol string) (string, error) {
	ip, e := netip.ParseAddr(target)
	if e != nil || !ReturnPublicIP(target) || ip.Zone() != "" || ip.Is4In6() || (family != "IPv4" && family != "IPv6") || ip.Is4() != (family == "IPv4") {
		return "", fmt.Errorf("invalid public target")
	}
	args := "-4"
	if family == "IPv6" {
		args = "-6"
	}
	switch protocol {
	case "tcp":
		args += " -T -p 80"
	case "udp":
		args += " -U -p 33494"
	case "icmp":
	default:
		return "", fmt.Errorf("invalid protocol")
	}
	script := `umask 077
fail(){ printf "NZR|%s\n" "$1"; exit 0; }
[ "$(uname -s)" = Linux ] || fail unsupported
for tool in curl sha256sum timeout stat mktemp; do command -v "$tool" >/dev/null 2>&1 || fail tool_missing; done
case "$(uname -m)" in
 x86_64) arch=amd64; digest=52b4a69aa2108332f53ca2e73ffdb2937cb6cf80a6f1730765fe2209ca720f7d ;;
 aarch64|arm64) arch=arm64; digest=10c8a06c9f516b737c82a2c7ce6571e3a1165bf420805b508f384af277f31147 ;;
 armv7l) arch=armv7; digest=4063e34bfb2bea50a9f2bdb141c27f8d94b8d052036c4989a532beadd3954162 ;;
 *) fail unsupported ;;
esac
[ "$(id -u)" = 0 ] || fail permission
cache=/var/cache/nezha-nexttrace-v1.7.3
if [ ! -e "$cache" ]; then mkdir "$cache" 2>/dev/null || [ -d "$cache" ] || fail tool_missing; fi
[ -d "$cache" ] && [ ! -L "$cache" ] && [ "$(stat -c %u:%a "$cache")" = 0:700 ] || fail permission
bin="$cache/nexttrace-tiny-$arch"
part=""; output=""
cleanup(){ [ -z "$part" ] || rm -f -- "$part"; [ -z "$output" ] || rm -f -- "$output"; }
trap cleanup EXIT HUP INT TERM
if [ -L "$bin" ] || ! printf "%s  %s\n" "$digest" "$bin" | sha256sum -c - >/dev/null 2>&1; then
 part=$(mktemp "$cache/download.XXXXXX") || fail tool_missing
 curl -q --noproxy "*" --proto "=https" --proto-redir "=https" -fLsS --connect-timeout 5 --max-time 25 --max-filesize 52428800 "https://github.com/nxtrace/NTrace-core/releases/download/v1.7.3/nexttrace-tiny_linux_$arch" -o "$part" 2>/dev/null || fail download_failed
 printf "%s  %s\n" "$digest" "$part" | sha256sum -c - >/dev/null 2>&1 || fail integrity_failed
 chmod 700 "$part" && mv -f -- "$part" "$bin" || fail tool_missing
 part=""
fi
output=$(mktemp "$cache/result.XXXXXX") || fail tool_missing
(ulimit -f 512; timeout -s TERM -k 2 35 "$bin" -j -M -n -C -q 3 --max-attempts 3 -m 30 --timeout 1000 --parallel-requests 6 -i 150 -g cn ` + args + " " + ip.String() + ` > "$output" 2>/dev/null)
rc=$?
printf "NZR|%s\n" "$rc"
head -c 262145 "$output"
`
	return "sh -c '" + strings.ReplaceAll(script, "'", "'\\''") + "'", nil
}

type traceReply struct {
	Hops [][]struct {
		Success bool
		Address *struct{ IP string }
		TTL     int
		RTT     float64
		Geo     *struct {
			ASN       string `json:"asnumber"`
			Country   string
			Province  string `json:"prov"`
			City      string
			Owner     string
			ISP       string
			Latitude  *float64 `json:"lat"`
			Longitude *float64 `json:"lng"`
		}
	}
}

func cleanRouteText(s string) string {
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, s)
	r := []rune(s)
	if len(r) > 100 {
		r = r[:100]
	}
	return strings.TrimSpace(string(r))
}
func ParseReturnResult(base ReturnResult, body string, successful bool) ReturnResult {
	if target, err := netip.ParseAddr(base.Target); err == nil {
		base.Target = target.String()
	}
	base.Status = "invalid_result"
	base.Hops = nil
	base.Route = nil
	if len(body) > ReturnOutputLimit {
		return base
	}
	if !successful && strings.Contains(body, "已禁止命令执行") {
		base.Status = "disabled"
		return base
	}
	marker, raw, ok := strings.Cut(body, "\n")
	if !ok {
		raw = ""
		marker = strings.TrimSpace(body)
	}
	status := strings.TrimPrefix(strings.TrimSpace(marker), "NZR|")
	switch status {
	case "unsupported", "tool_missing", "permission", "download_failed", "integrity_failed":
		base.Status = status
		return base
	case "124", "137", "143":
		base.Status = "timeout"
		return base
	}
	if status != "0" {
		base.Status = "probe_failed"
		return base
	}
	var reply traceReply
	if json.Unmarshal([]byte(raw), &reply) != nil || len(reply.Hops) < 1 || len(reply.Hops) > 30 {
		return base
	}
	base.Status = "no_reply"
	for index, samples := range reply.Hops {
		if len(samples) > 3 {
			return ReturnResult{ID: base.ID, Name: base.Name, Carrier: base.Carrier, Family: base.Family, Target: base.Target, Protocol: base.Protocol, Status: "invalid_result"}
		}
		rows := []ReturnHop{}
		totals := map[string]float64{}
		byIP := map[string]int{}
		for _, s := range samples {
			if !s.Success || s.Address == nil || s.TTL != index+1 || s.RTT < 0 || s.RTT > 60e9 {
				continue
			}
			ip, e := netip.ParseAddr(s.Address.IP)
			if e != nil || ip.Zone() != "" {
				continue
			}
			address := ip.String()
			if address == base.Target {
				base.Status = "reached"
			} else if base.Status != "reached" {
				base.Status = "partial"
			}
			if at, ok := byIP[address]; ok {
				rows[at].Samples++
				totals[address] += s.RTT / 1e6
				continue
			}
			hop := ReturnHop{TTL: index + 1, IP: address, Samples: 1}
			if s.Geo != nil && PublicIP(address) {
				if asn, e := strconv.ParseUint(s.Geo.ASN, 10, 32); e == nil && asn > 0 {
					hop.ASN = strconv.FormatUint(asn, 10)
				}
				// NextTrace uses (0,0) for unknown locations. Do not invent map points.
				if lat, lon := s.Geo.Latitude, s.Geo.Longitude; lat != nil && lon != nil &&
					*lat >= -90 && *lat <= 90 && *lon >= -180 && *lon <= 180 && (*lat != 0 || *lon != 0) {
					hop.Latitude, hop.Longitude = lat, lon
				}
				hop.Country = cleanRouteText(s.Geo.Country)
				hop.Location = cleanRouteText(strings.Join([]string{s.Geo.Country, s.Geo.Province, s.Geo.City}, " "))
				hop.Organization = cleanRouteText(s.Geo.Owner)
				if hop.Organization == "" {
					hop.Organization = cleanRouteText(s.Geo.ISP)
				}
			}
			byIP[address] = len(rows)
			totals[address] = s.RTT / 1e6
			rows = append(rows, hop)
		}
		if len(rows) == 0 {
			rows = append(rows, ReturnHop{TTL: index + 1})
		}
		for i := range rows {
			if rows[i].Samples > 0 {
				avg := totals[rows[i].IP] / float64(rows[i].Samples)
				rows[i].RTT = &avg
			}
		}
		base.Hops = append(base.Hops, rows...)
	}
	AnnotateReturnRoute(&base)
	return base
}
