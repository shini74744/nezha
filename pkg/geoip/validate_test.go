package geoip

import "testing"

func TestValidateDatabaseRejectsPlaceholderAndErrorPages(t *testing.T) {
	for name, data := range map[string][]byte{
		"missing":             nil,
		"source-placeholder":  []byte("stub\n"),
		"download-error-page": []byte("<html>Access denied</html>"),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := validateDatabase(data); err == nil {
				t.Fatal("invalid GeoIP data must be rejected before release")
			}
		})
	}
}
