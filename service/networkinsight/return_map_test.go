package networkinsight

import (
	"encoding/json"
	"fmt"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestReturnCoordinatesAreValidatedAndPrivateLocationsOmitted(t *testing.T) {
	for _, c := range []struct {
		name, ip, geo string
		valid         bool
	}{
		{"valid", "1.1.1.1", `"lat":31.23,"lng":121.47`, true},
		{"equator", "1.1.1.1", `"lat":0,"lng":12`, true},
		{"prime-meridian", "1.1.1.1", `"lat":12,"lng":0`, true},
		{"missing", "1.1.1.1", `"city":"上海"`, false},
		{"half", "1.1.1.1", `"lat":31`, false},
		{"unknown-zero", "1.1.1.1", `"lat":0,"lng":0`, false},
		{"out-of-range", "1.1.1.1", `"lat":91,"lng":121`, false},
		{"out-of-longitude", "1.1.1.1", `"lat":31,"lng":181`, false},
		{"private", "10.0.0.1", `"lat":31,"lng":121`, false},
	} {
		t.Run(c.name, func(t *testing.T) {
			body := fmt.Sprintf("NZR|0\n"+`{"Hops":[[{"Success":true,"Address":{"IP":%q},"TTL":1,"RTT":1000000,"Geo":{%s}}]]}`, c.ip, c.geo)
			r := ParseReturnResult(ReturnResult{Target: "1.1.1.1"}, body, true)
			require.Len(t, r.Hops, 1)
			require.Equal(t, c.valid, r.Hops[0].Latitude != nil)
			require.Equal(t, c.valid, r.Hops[0].Longitude != nil)
			raw, err := json.Marshal(r)
			require.NoError(t, err)
			var saved ReturnResult
			require.NoError(t, json.Unmarshal(raw, &saved))
			require.Equal(t, r, saved)
		})
	}
}
func TestReturnMapRedactionDoesNotLeakHiddenHopCoordinates(t *testing.T) {
	lat, lon := 31.2, 121.4
	r := ReturnResult{Hops: []ReturnHop{
		{TTL: 1, IP: "45.78.0.1", ASN: "25820", Samples: 3, Latitude: &lat, Longitude: &lon},
		{TTL: 2, IP: "223.120.1.1", ASN: "58807", Network: "移动 CMIN2", Samples: 3, Latitude: &lat, Longitude: &lon},
		{TTL: 3, IP: "223.120.2.1", ASN: "58807", Network: "移动 CMIN2", Samples: 3, Latitude: &lat, Longitude: &lon},
	}}
	// The first carrier response at TTL 2 is still protected, but a later public carrier hop can be mapped.
	RedactReturnRoute(&r)
	require.Nil(t, r.Hops[0].Latitude)
	require.Nil(t, r.Hops[1].Longitude)
	require.NotNil(t, r.Hops[2].Latitude)
}
