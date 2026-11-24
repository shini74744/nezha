package appearance

import _ "embed"

//go:embed manifest.json
var Manifest []byte

//go:embed dashboard-manifest.json
var DashboardManifest []byte

//go:embed paper-defaults.json
var PaperDefaults []byte
