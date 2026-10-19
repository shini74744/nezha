//go:build releaseassets

package geoip

import (
	"net"
	"strings"
	"testing"

	maxminddb "github.com/oschwald/maxminddb-golang"
)

// Release builds must replace the source placeholder with a reviewed database.
// Keep this opt-in so ordinary source-only CI does not need licensed inputs.
func TestReleaseGeoIPAsset(t *testing.T) {
	reader, err := maxminddb.FromBytes(db)
	if err != nil {
		t.Fatalf("release GeoIP database is invalid: %v", err)
	}
	defer reader.Close()
	if reader.Metadata.NodeCount == 0 {
		t.Fatal("release GeoIP database has no records")
	}
	for _, address := range []string{"8.8.8.8", "2001:4860:4860::8888"} {
		t.Run(address, func(t *testing.T) {
			var record IPInfo
			if err := reader.Lookup(net.ParseIP(address), &record); err != nil {
				t.Fatal(err)
			}
			if len(record.Country) != 2 {
				t.Fatalf("country record missing for release fixture %s", address)
			}
			got, err := Lookup(net.ParseIP(address))
			if err != nil || got != strings.ToLower(record.Country) {
				t.Fatalf("release lookup failed: country=%q err=%v", got, err)
			}
		})
	}
}
