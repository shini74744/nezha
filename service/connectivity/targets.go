package connectivity

import (
	_ "embed"
	"encoding/json"
)

// Catalog is maintained alongside the tests and local brand assets. URLs remain
// server-owned and are deliberately omitted from the public Target response.
//
//go:embed catalog.json
var catalogJSON []byte

// Exact prior built-in values only; custom endpoints are never rewritten.
//
//go:embed legacy_endpoints.json
var legacyEndpointsJSON []byte

var legacyEndpoints = func() map[string]string {
	var values map[string]string
	if err := json.Unmarshal(legacyEndpointsJSON, &values); err != nil {
		panic("invalid legacy connectivity endpoints: " + err.Error())
	}
	return values
}()

var targets = loadTargets()

func loadTargets() []Target {
	var rows []struct{ ID, Name, Group, Host, URL string }
	if err := json.Unmarshal(catalogJSON, &rows); err != nil {
		panic("invalid built-in connectivity catalog: " + err.Error())
	}
	out := make([]Target, len(rows))
	for i, row := range rows {
		out[i] = Target{ID: row.ID, Name: row.Name, Group: row.Group, Host: row.Host, URL: row.URL}
	}
	return out
}
