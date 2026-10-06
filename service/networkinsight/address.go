package networkinsight

import (
	"net/netip"
	"strings"
)

// Two fixed public HTTPS endpoints. Force IPv6 and bypass environment proxies.
// A bounded response is parsed strictly; raw bodies never reach the public API.
func IPv6Command() string {
	return `sh -c 'command -v curl >/dev/null 2>&1 || exit 1
for url in https://api6.ipify.org https://www.cloudflare.com/cdn-cgi/trace; do
 body=$(curl -q -6 --noproxy "*" --proto "=https" --connect-timeout 3 --max-time 5 --max-filesize 4096 -fsS "$url" 2>/dev/null) || continue
 printf "%s\n" "$body"
done'`
}
func ParseIPv6(body string) string {
	for _, line := range strings.Split(body, "\n") {
		value := strings.TrimSpace(strings.TrimPrefix(line, "ip="))
		ip, err := netip.ParseAddr(value)
		if err == nil && ip.Is6() && !ip.Is4In6() && PublicIP(value) {
			return ip.String()
		}
	}
	return ""
}
