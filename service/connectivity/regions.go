package connectivity

import (
	_ "embed"
	"encoding/json"
)

//go:embed regions.json
var regionsJSON []byte

// ValidRegion uses the same registry as both frontends.
func ValidRegion(id string) bool {
	var regions []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(regionsJSON, &regions); err != nil {
		panic(err)
	}
	for _, region := range regions {
		if region.ID == id {
			return true
		}
	}
	return false
}
