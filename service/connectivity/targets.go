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
