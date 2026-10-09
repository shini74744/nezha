package model

// BatchServerVisibilityForm only changes explicitly supplied visibility flags.
type BatchServerVisibilityForm struct {
	ConnectivityLocalOnly *bool    `json:"connectivity_local_only,omitempty"`
	IDs                   []uint64 `json:"ids"`
	HideForGuest          *bool    `json:"hide_for_guest,omitempty"`
	HideForDisplay        *bool    `json:"hide_for_display,omitempty"`
	ConnectivityDisabled  *bool    `json:"connectivity_disabled,omitempty"`
	BGPDisabled           *bool    `json:"bgp_disabled,omitempty"`
	ReturnRouteDisabled   *bool    `json:"return_route_disabled,omitempty"`
	StreamingDisabled     *bool    `json:"streaming_disabled,omitempty"`
}

type BatchServerVisibilityResult struct {
	Updated int `json:"updated"`
}
