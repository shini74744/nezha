package monitor

import (
	"github.com/nezhahq/agent/model"
	"testing"
	"time"
)

func TestFetchIPReportsEitherFamilyChange(t *testing.T) {
	tests := []struct {
		name                             string
		use6                             bool
		before4, before6, after4, after6 string
	}{
		{"ipv6 changes with stable ipv4", false, "192.0.2.1", "2001:db8::1", "192.0.2.1", "2001:db8::2"},
		{"ipv6 appears", false, "192.0.2.1", "", "192.0.2.1", "2001:db8::2"},
		{"ipv6 disappears", false, "192.0.2.1", "2001:db8::1", "192.0.2.1", ""},
		{"ipv4 changes with ipv6 preferred", true, "192.0.2.1", "2001:db8::1", "192.0.2.2", "2001:db8::1"},
		{"ipv4 disappears with ipv6 preferred", true, "192.0.2.1", "2001:db8::1", "", "2001:db8::1"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			original := captureMonitorTestState()
			t.Cleanup(original.restore)
			geoIPLock.Lock()
			retryTimes, failedStartedAt, latestRetryAt = 0, time.Time{}, time.Time{}
			geoQueryIP, geoIPChanged = "", true
			geoIPLock.Unlock()
			v4, v6 := tc.before4, tc.before6
			fetchIPProbe = func(_ []string, is6 bool) string {
				if is6 {
					return v6
				}
				return v4
			}
			if FetchIP(&model.AgentConfig{}, tc.use6) == nil {
				t.Fatal("initial report missing")
			}
			MarkGeoIPReported("test")
			FetchIP(&model.AgentConfig{}, tc.use6)
			if GeoIPChanged() {
				t.Fatal("unchanged addresses marked dirty")
			}
			v4, v6 = tc.after4, tc.after6
			report := FetchIP(&model.AgentConfig{}, tc.use6)
			if report == nil || report.GetIp().GetIpv4() != v4 || report.GetIp().GetIpv6() != v6 {
				t.Fatal("report does not contain new pair")
			}
			if !GeoIPChanged() {
				t.Fatal("one address family changed without triggering report")
			}
			// A failed RPC must leave the report dirty for the next attempt.
			FetchIP(&model.AgentConfig{}, tc.use6)
			if !GeoIPChanged() {
				t.Fatal("unacknowledged change lost")
			}
			MarkGeoIPReported("test")
			FetchIP(&model.AgentConfig{}, tc.use6)
			if GeoIPChanged() {
				t.Fatal("acknowledged unchanged pair reported again")
			}
		})
	}
}
