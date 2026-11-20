package geoip

import (
	"fmt"
	"net"
	"strings"

	maxminddb "github.com/oschwald/maxminddb-golang"
)

// ValidateEmbedded checks the data in the executable without loading dashboard
// settings, opening the monitoring database or starting any network listeners.
func ValidateEmbedded() (map[string]string, error) {
	return validateDatabase(db)
}

func validateDatabase(data []byte) (map[string]string, error) {
	reader, err := maxminddb.FromBytes(data)
	if err != nil {
		return nil, fmt.Errorf("invalid embedded database: %w", err)
	}
	defer reader.Close()
	if reader.Metadata.NodeCount == 0 {
		return nil, fmt.Errorf("embedded database has no records")
	}
	results := make(map[string]string)
	for _, address := range []string{"8.8.8.8", "2001:4860:4860::8888"} {
		var record IPInfo
		if err := reader.Lookup(net.ParseIP(address), &record); err != nil {
			return nil, fmt.Errorf("lookup %s: %w", address, err)
		}
		code := strings.ToLower(record.Country)
		if len(code) != 2 || code[0] < 'a' || code[0] > 'z' || code[1] < 'a' || code[1] > 'z' {
			return nil, fmt.Errorf("country record missing for %s", address)
		}
		results[address] = code
	}
	return results, nil
}
