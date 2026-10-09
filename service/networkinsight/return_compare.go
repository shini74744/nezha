package networkinsight

import (
	"net/netip"
	"strconv"
)

// GroupReturnComparisons assigns response-local opaque groups before redaction.
// Equality exposes only whether the configured target/protocol match, not an IP
// or a brute-forceable hash. Call once with all snapshots in the same response;
// clients must compare snapshots from that response, never persist these keys.
func GroupReturnComparisons(snapshots ...*Snapshot) {
	groups := map[[4]string]string{}
	for _, s := range snapshots {
		if s == nil {
			continue
		}
		for i := range s.Routes {
			r := &s.Routes[i]
			r.ComparisonKey = ""
			ip, err := netip.ParseAddr(r.Target)
			if err != nil {
				continue
			}
			key := [4]string{r.ID, r.Family, r.Protocol, ip.Unmap().String()}
			group := groups[key]
			if group == "" {
				group = strconv.Itoa(len(groups) + 1)
				groups[key] = group
			}
			r.ComparisonKey = group
		}
	}
}
